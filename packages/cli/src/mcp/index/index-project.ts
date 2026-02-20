import type { ResolvedZipbulConfig } from '../../config';

import { parseSync } from 'oxc-parser';
import type { Program } from 'oxc-parser';
import { stat } from 'node:fs/promises';
import { join, relative, resolve } from 'path';

import { eq, inArray, or, sql } from 'drizzle-orm';

import type { StoreDb } from '../../store/connection';
import { codeEntity, codeRelation, fileState } from '../../store/schema';


import {
  CallsExtractor,
  ExtendsExtractor,
  ImplementsExtractor,
  ImportsExtractor,
} from '../../compiler/extractors';

export type IndexMode = 'full' | 'incremental';

export interface IndexProjectInput {
  projectRoot: string;
  config: ResolvedZipbulConfig;
  db: StoreDb;
  mode: IndexMode;
}

export interface IndexProjectStats {
  indexedCodeFiles: number;
  removedFiles: number;
}

export interface IndexProjectResult {
  stats: IndexProjectStats;
}

function toPosixPath(path: string): string {
  return path.replace(/\\/g, '/');
}

function nowIso(): string {
  return new Date().toISOString();
}

function sha256HexOfText(text: string): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(text);
  return hasher.digest('hex');
}

function computeFingerprint(symbolName: string | null, kind: string, signature: string | null): string {
  return sha256HexOfText(`${symbolName ?? ''}|${kind}|${signature ?? ''}`);
}

const txDepthByDb = new WeakMap<object, number>();

async function withTransaction<T>(db: StoreDb, fn: () => Promise<T>): Promise<T> {
  const key = db as unknown as object;
  const depth = txDepthByDb.get(key) ?? 0;
  const nextDepth = depth + 1;
  const sp = `sp_${nextDepth}`;

  if (depth === 0) {
    db.run(sql`BEGIN`);
  } else {
    db.run(sql.raw(`SAVEPOINT ${sp}`));
  }

  txDepthByDb.set(key, nextDepth);
  try {
    const out = await fn();
    if (depth === 0) {
      db.run(sql`COMMIT`);
    } else {
      db.run(sql.raw(`RELEASE SAVEPOINT ${sp}`));
    }
    return out;
  } catch (err) {
    try {
      if (depth === 0) {
        db.run(sql`ROLLBACK`);
      } else {
        db.run(sql.raw(`ROLLBACK TO SAVEPOINT ${sp}`));
        db.run(sql.raw(`RELEASE SAVEPOINT ${sp}`));
      }
    } catch {
      // ignore rollback failures
    }
    throw err;
  } finally {
    if (depth === 0) {
      txDepthByDb.delete(key);
    } else {
      txDepthByDb.set(key, depth);
    }
  }
}

async function readFileStateMap(db: StoreDb): Promise<Map<string, { contentHash: string; mtime: string }>> {
  const rows = db.select().from(fileState).all();
  const map = new Map<string, { contentHash: string; mtime: string }>();
  for (const row of rows) {
    map.set(row.path, { contentHash: row.contentHash, mtime: row.mtime });
  }
  return map;
}

async function sha256HexOfFile(absPath: string): Promise<string> {
  const buf = await Bun.file(absPath).arrayBuffer();
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(buf);
  return hasher.digest('hex');
}

async function scanGlobRel(projectRoot: string, pattern: string): Promise<string[]> {
  const glob = new Bun.Glob(pattern);
  const out: string[] = [];
  for await (const rel of glob.scan({ cwd: projectRoot, onlyFiles: true, dot: true })) {
    out.push(toPosixPath(String(rel)));
  }
  return out;
}

async function buildExcludeSet(projectRoot: string, patterns: string[]): Promise<Set<string>> {
  const set = new Set<string>();
  for (const pattern of patterns) {
    const matches = await scanGlobRel(projectRoot, pattern);
    for (const rel of matches) {
      set.add(rel);
    }
  }
  return set;
}

function isCodePath(relPath: string, sourceDirRel: string): boolean {
  return relPath.startsWith(sourceDirRel.endsWith('/') ? sourceDirRel : `${sourceDirRel}/`) && relPath.endsWith('.ts');
}

function normalizeSourceDirRel(sourceDir: string): string {
  const trimmed = sourceDir.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '').replace(/\/$/, '');
  return trimmed.length === 0 ? 'src' : trimmed;
}

async function upsertFileStateRow(db: StoreDb, relPath: string, contentHash: string, mtimeMs: number) {
  const now = nowIso();
  db.insert(fileState)
    .values({
      path: relPath,
      contentHash,
      mtime: String(mtimeMs),
      lastIndexedAt: now,
    })
    .onConflictDoUpdate({
      target: fileState.path,
      set: {
        contentHash,
        mtime: String(mtimeMs),
        lastIndexedAt: now,
      },
    })
    .run();
}

async function deleteRemovedFile(db: StoreDb, relPath: string, opts?: { keepEntityKeys?: Set<string> }) {
  const entityKeys = db
    .select({ entityKey: codeEntity.entityKey })
    .from(codeEntity)
    .where(eq(codeEntity.filePath, relPath))
    .all()
    .map((r) => r.entityKey);

  const kept = opts?.keepEntityKeys;
  const deletableEntityKeys = kept ? entityKeys.filter((k) => !kept.has(k)) : entityKeys;

  if (deletableEntityKeys.length > 0) {
    db.delete(codeRelation)
      .where(
        or(
          inArray(codeRelation.srcEntityKey, deletableEntityKeys),
          inArray(codeRelation.dstEntityKey, deletableEntityKeys),
        ),
      )
      .run();
  }

  if (kept && kept.size > 0) {
    if (deletableEntityKeys.length > 0) {
      db.delete(codeEntity).where(inArray(codeEntity.entityKey, deletableEntityKeys)).run();
    }
  } else {
    db.delete(codeEntity).where(eq(codeEntity.filePath, relPath)).run();
  }
  db.delete(fileState).where(eq(fileState.path, relPath)).run();
}

function clearIndexTables(db: StoreDb) {
  // Delete in FK-safe order.
  db.delete(codeRelation).run();
  db.delete(codeEntity).run();
  db.delete(fileState).run();
}

type PreferredEntityMeta = {
  kind?: string;
  signature?: string | null;
};

async function ensureCodeEntity(
  db: StoreDb,
  entityKey: string,
  contentHashByFile: Map<string, string>,
  preferred?: PreferredEntityMeta,
) {
  const [kind, rest] = entityKey.split(':', 2);
  if (!rest) return;

  let filePath = '';
  let symbolName: string | null = null;

  let kindValue: string;
  let signature: string | null;

  if (kind === 'module') {
    filePath = rest;
    kindValue = preferred?.kind ?? 'module';
    // For modules, use the file content hash as a stable signature for move tracking.
    signature = preferred?.signature ?? (contentHashByFile.get(filePath) ?? '0');
  } else if (kind === 'symbol') {
    const hashIdx = rest.indexOf('#');
    if (hashIdx === -1) return;
    filePath = rest.slice(0, hashIdx);
    symbolName = rest.slice(hashIdx + 1);
    kindValue = preferred?.kind ?? 'symbol';
    signature = preferred?.signature ?? null;
  } else {
    return;
  }

  const contentHash = contentHashByFile.get(filePath) ?? '0';
  const updatedAt = nowIso();
  const fingerprint = computeFingerprint(symbolName, kindValue, signature);

  db.insert(codeEntity)
    .values({
      entityKey,
      filePath,
      symbolName,
      kind: kindValue,
      signature,
      fingerprint,
      contentHash,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: codeEntity.entityKey,
      set: {
        filePath,
        symbolName,
        kind: kindValue,
        signature,
        fingerprint,
        contentHash,
        updatedAt,
      },
    })
    .run();
}

type DeclSymbol = {
  name: string;
  kind: string;
  signature: string | null;
};

function extractTopLevelDeclaredSymbols(ast: Program): DeclSymbol[] {
  const out: DeclSymbol[] = [];

  const pushFn = (name: string, signature: string | null) => out.push({ name, kind: 'function', signature });
  const pushClass = (name: string) => out.push({ name, kind: 'class', signature: null });
  const pushVar = (name: string) => out.push({ name, kind: 'variable', signature: null });

  const handleDecl = (decl: any) => {
    if (!decl || typeof decl !== 'object') return;

    if (decl.type === 'FunctionDeclaration') {
      const name = decl.id?.name;
      if (typeof name === 'string' && name.length > 0) {
        const params = Array.isArray(decl.params) ? decl.params.length : 0;
        const isAsync = Boolean(decl.async);
        pushFn(name, `params:${params}|async:${isAsync ? 1 : 0}`);
      }
      return;
    }

    if (decl.type === 'ClassDeclaration') {
      const name = decl.id?.name;
      if (typeof name === 'string' && name.length > 0) {
        pushClass(name);
      }
      return;
    }

    if (decl.type === 'VariableDeclaration') {
      const decls = Array.isArray(decl.declarations) ? decl.declarations : [];
      for (const d of decls) {
        const idName = d?.id?.type === 'Identifier' ? d.id.name : null;
        if (typeof idName === 'string' && idName.length > 0) {
          pushVar(idName);
        }
      }
    }
  };

  for (const stmt of ast.body) {
    if (!stmt || typeof stmt !== 'object') continue;

    if (stmt.type === 'ExportNamedDeclaration') {
      // export function foo() {}
      handleDecl((stmt as any).declaration);
      continue;
    }

    if (stmt.type === 'ExportDefaultDeclaration') {
      // export default function() {} / export default class {}
      const decl = (stmt as any).declaration;
      const name = decl?.id?.name;
      const sym = typeof name === 'string' && name.length > 0 ? name : 'default';
      const params = Array.isArray(decl?.params) ? decl.params.length : 0;
      if (decl?.type === 'FunctionDeclaration') {
        pushFn(sym, `params:${params}|async:${decl.async ? 1 : 0}`);
      } else if (decl?.type === 'ClassDeclaration') {
        pushClass(sym);
      } else {
        pushVar('default');
      }
      continue;
    }

    // non-exported top-level decls (best-effort)
    handleDecl(stmt);
  }

  const seen = new Set<string>();
  const dedup: DeclSymbol[] = [];
  for (const s of out) {
    const k = `${s.kind}|${s.name}|${s.signature ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    dedup.push(s);
  }
  return dedup;
}

function normalizeEntityKey(projectRoot: string, entityKey: string): string | null {
  if (entityKey.startsWith('module:')) {
    const p = entityKey.slice('module:'.length);
    const abs = resolve(process.cwd(), p);
    const rel = toPosixPath(relative(projectRoot, abs));
    if (!rel || rel.startsWith('..')) return null;
    return `module:${rel}`;
  }

  if (entityKey.startsWith('symbol:')) {
    const rest = entityKey.slice('symbol:'.length);
    const hashIdx = rest.indexOf('#');
    if (hashIdx === -1) return null;
    const p = rest.slice(0, hashIdx);
    const name = rest.slice(hashIdx + 1);
    const abs = resolve(process.cwd(), p);
    const rel = toPosixPath(relative(projectRoot, abs));
    if (!rel || rel.startsWith('..')) return null;
    return `symbol:${rel}#${name}`;
  }

  return null;
}

export async function indexProject(input: IndexProjectInput): Promise<IndexProjectResult> {
  const { projectRoot, config, db, mode } = input;

  const sourceDirRel = normalizeSourceDirRel(config.sourceDir);
  const codePathsRel = await scanGlobRel(projectRoot, `${sourceDirRel}/**/*.ts`);

  const excludeSet = await buildExcludeSet(projectRoot, config.mcp.exclude);
  const scanned = codePathsRel.filter((p) => !excludeSet.has(p));
  const scannedSet = new Set(scanned);

  const trackedState = mode === 'incremental' ? await readFileStateMap(db) : new Map<string, { contentHash: string; mtime: string }>();

  const removed: string[] = [];
  if (mode === 'incremental') {
    for (const path of trackedState.keys()) {
      if (isCodePath(path, sourceDirRel) && !scannedSet.has(path)) {
        removed.push(path);
      }
    }
  }

  const changedCodeFiles: string[] = [];
  const addedCodeFiles: string[] = [];

  const candidates = mode === 'full' ? scanned : scanned;

  for (const relPath of candidates) {
    const absPath = join(projectRoot, relPath);
    const st = await stat(absPath);
    const contentHash = await sha256HexOfFile(absPath);
    const prev = trackedState.get(relPath);

    const changed = mode === 'full' || !prev || prev.contentHash !== contentHash || prev.mtime !== String(st.mtimeMs);
    if (!changed) {
      continue;
    }

    if (isCodePath(relPath, sourceDirRel)) {
      changedCodeFiles.push(relPath);
      if (mode === 'incremental' && !prev) {
        addedCodeFiles.push(relPath);
      }
    }
  }

  const runIndexing = async (): Promise<IndexProjectResult> => {
    if (mode === 'full') {
      clearIndexTables(db);
    }


    // Code
    const removedCodeFiles = mode === 'incremental' ? removed.filter((p) => isCodePath(p, sourceDirRel)) : [];
    const removedEntitiesBeforeDelete =
      mode === 'incremental' && removedCodeFiles.length > 0
        ? db
            .select({ entityKey: codeEntity.entityKey, fingerprint: codeEntity.fingerprint, filePath: codeEntity.filePath })
            .from(codeEntity)
            .where(inArray(codeEntity.filePath, removedCodeFiles))
            .all()
        : [];

    for (const relPath of changedCodeFiles) {
      // eslint-disable-next-line no-await-in-loop
      await withTransaction(db, async () => {
        const absPath = join(projectRoot, relPath);
        const st = await stat(absPath);
        const codeText = await Bun.file(absPath).text();
        const contentHash = await sha256HexOfFile(absPath);

        // Precompute hashes for referenced files (best-effort)
        const contentHashByFile = new Map<string, string>();
        contentHashByFile.set(relPath, contentHash);

        const ast = parseSync(absPath, codeText).program as Program;

        const declaredSymbols = extractTopLevelDeclaredSymbols(ast);
        const preferredMetaByEntityKey = new Map<string, PreferredEntityMeta>();
        for (const sym of declaredSymbols) {
          preferredMetaByEntityKey.set(`symbol:${relPath}#${sym.name}`, { kind: sym.kind, signature: sym.signature });
        }

        const rawRelations = [
          ...ImportsExtractor.extract(ast, absPath),
          ...CallsExtractor.extract(ast, absPath),
          ...ExtendsExtractor.extract(ast, absPath),
          ...ImplementsExtractor.extract(ast, absPath),
        ];

        const relations = rawRelations
          .map((r) => {
            const src = normalizeEntityKey(projectRoot, r.srcEntityKey);
            const dst = normalizeEntityKey(projectRoot, r.dstEntityKey);
            if (!src || !dst) return null;
            return { ...r, srcEntityKey: src, dstEntityKey: dst };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null);

        // Ensure entities exist (skip relations pointing to missing files)
        const filteredRelations: typeof relations = [];
        for (const r of relations) {
          const srcKey = r.srcEntityKey;
          const dstKey = r.dstEntityKey;

          const srcFile = srcKey.startsWith('module:')
            ? srcKey.slice('module:'.length)
            : srcKey.startsWith('symbol:')
              ? srcKey.slice('symbol:'.length).split('#')[0]!
              : null;
          const dstFile = dstKey.startsWith('module:')
            ? dstKey.slice('module:'.length)
            : dstKey.startsWith('symbol:')
              ? dstKey.slice('symbol:'.length).split('#')[0]!
              : null;

          if (!srcFile || !dstFile) continue;

          // Resolve to abs and compute hash if file exists.
          const absSrc = join(projectRoot, srcFile);
          const absDst = join(projectRoot, dstFile);

          const srcExists = await Bun.file(absSrc).exists();
          const dstExists = await Bun.file(absDst).exists();
          if (!srcExists || !dstExists) continue;

          if (!contentHashByFile.has(srcFile)) {
            contentHashByFile.set(srcFile, await sha256HexOfFile(absSrc));
          }
          if (!contentHashByFile.has(dstFile)) {
            contentHashByFile.set(dstFile, await sha256HexOfFile(absDst));
          }

          filteredRelations.push(r);
        }

        const allEntityKeys = new Set<string>();
        allEntityKeys.add(`module:${relPath}`);
        for (const sym of declaredSymbols) {
          allEntityKeys.add(`symbol:${relPath}#${sym.name}`);
        }
        for (const r of filteredRelations) {
          allEntityKeys.add(r.srcEntityKey);
          allEntityKeys.add(r.dstEntityKey);
        }

        for (const entityKey of allEntityKeys) {
          // eslint-disable-next-line no-await-in-loop
          await ensureCodeEntity(db, entityKey, contentHashByFile, preferredMetaByEntityKey.get(entityKey));
        }

        // Replace relations originating from this file (module + all symbol entities under same file)
        const srcEntityKeys = db
          .select({ entityKey: codeEntity.entityKey })
          .from(codeEntity)
          .where(eq(codeEntity.filePath, relPath))
          .all()
          .map((r) => r.entityKey);

        if (srcEntityKeys.length > 0) {
          db.delete(codeRelation).where(inArray(codeRelation.srcEntityKey, srcEntityKeys)).run();
        }

        if (filteredRelations.length > 0) {
          db.insert(codeRelation)
            .values(
              filteredRelations.map((r) => ({
                type: r.type,
                srcEntityKey: r.srcEntityKey,
                dstEntityKey: r.dstEntityKey,
                metaJson: r.metaJson ?? null,
              })),
            )
            .run();
        }

        await upsertFileStateRow(db, relPath, contentHash, st.mtimeMs);
      });
    }

    // Fingerprint-based move tracking (incremental): retarget relations/links before deleting removed code files.
    if (mode === 'incremental' && removedCodeFiles.length > 0 && removedEntitiesBeforeDelete.length > 0 && addedCodeFiles.length > 0) {
      const movedOldKeys = new Set<string>();

      await withTransaction(db, async () => {
        const newEntities = db
          .select({ entityKey: codeEntity.entityKey, fingerprint: codeEntity.fingerprint, filePath: codeEntity.filePath })
          .from(codeEntity)
          .where(inArray(codeEntity.filePath, addedCodeFiles))
          .all();

        const oldByFp = new Map<string, Array<{ entityKey: string; filePath: string }>>();
        for (const e of removedEntitiesBeforeDelete) {
          if (!e.fingerprint) continue;
          const arr = oldByFp.get(e.fingerprint) ?? [];
          arr.push({ entityKey: e.entityKey, filePath: e.filePath });
          oldByFp.set(e.fingerprint, arr);
        }

        const newByFp = new Map<string, Array<{ entityKey: string; filePath: string }>>();
        for (const e of newEntities) {
          if (!e.fingerprint) continue;
          const arr = newByFp.get(e.fingerprint) ?? [];
          arr.push({ entityKey: e.entityKey, filePath: e.filePath });
          newByFp.set(e.fingerprint, arr);
        }

        for (const [fp, olds] of oldByFp.entries()) {
          const news = newByFp.get(fp);
          if (!news) continue;
          if (olds.length !== 1 || news.length !== 1) continue;

          const oldKey = olds[0]!.entityKey;
          const newKey = news[0]!.entityKey;
          if (oldKey === newKey) continue;

          // Update relations pointing to the old entity_key.
          db.update(codeRelation).set({ srcEntityKey: newKey }).where(eq(codeRelation.srcEntityKey, oldKey)).run();
          db.update(codeRelation).set({ dstEntityKey: newKey }).where(eq(codeRelation.dstEntityKey, oldKey)).run();

          db.delete(codeEntity).where(eq(codeEntity.entityKey, oldKey)).run();
          movedOldKeys.add(oldKey);
        }

        // Now delete removed code files, but keep moved entities (their edges were retargeted).
        for (const relPath of removedCodeFiles) {
          // per-file atomicity
          // eslint-disable-next-line no-await-in-loop
          await withTransaction(db, async () => {
            await deleteRemovedFile(db, relPath, { keepEntityKeys: movedOldKeys });
          });
        }
      });
    } else if (mode === 'incremental' && removedCodeFiles.length > 0) {
      for (const relPath of removedCodeFiles) {
        // per-file atomicity
        // eslint-disable-next-line no-await-in-loop
        await withTransaction(db, async () => {
          await deleteRemovedFile(db, relPath);
        });
      }
    }

    return {
      stats: {
        indexedCodeFiles: changedCodeFiles.length,
        removedFiles: removed.length,
      },
    };
  };

  if (mode === 'full') {
    return withTransaction(db, runIndexing);
  }

  return runIndexing();
}
