import type { ResolvedZipbulConfig } from '../../config';

import { relative } from 'node:path';

import { declareTool, ToolRegistry } from './tool-registry';

import * as z from 'zod/v3';

import { indexProject } from '../index/index-project';
import { zipbulCacheDirPath, zipbulCacheFilePath } from '../../common/zipbul-paths';
import { closeDb, createDb } from '../../store/connection';
import { OwnerElection } from '../../watcher/owner-election';
import { eq, sql } from 'drizzle-orm';
import { codeEntity, codeFts } from '../../store/schema';

function normalizeSourceDirRel(value: string): string {
  const trimmed = value.trim();
  const withoutDotSlash = trimmed.startsWith('./') ? trimmed.slice(2) : trimmed;
  const withoutTrailing = withoutDotSlash.replace(/\/+$/, '');
  return withoutTrailing.length === 0 ? 'src' : withoutTrailing;
}

export interface SearchCodeInput {
  projectRoot: string;
  query: string;
  limit: number;
}

export interface SearchCodeResult {
  results: Array<{
    entityKey: string;
    symbolName: string | null;
    filePath: string;
    kind: string;
    score: number;
  }>;
}

export interface GetCodeEntityInput {
  projectRoot: string;
  entityKey: string;
}

export interface GetCodeEntityResult {
  entity: {
    entityKey: string;
    filePath: string;
    symbolName: string | null;
    kind: string;
    signature?: string | null;
    fingerprint?: string | null;
    contentHash?: string;
    updatedAt?: string;
  } | null;
}

function clampLimit(limit: unknown, fallback: number): number {
  const n = typeof limit === 'number' ? limit : Number(limit);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i < 1) return 1;
  if (i > 50) return 50;
  return i;
}

async function searchCodeDefault(input: SearchCodeInput, deps: { createDb: typeof createDb; closeDb: typeof closeDb }): Promise<SearchCodeResult> {
  const dbPath = zipbulCacheFilePath(input.projectRoot, 'index.sqlite');
  const db = deps.createDb(dbPath);

  try {
    const scoreExpr = sql<number>`bm25(${codeFts})`;
    const rows = db
      .select({
        entityKey: codeEntity.entityKey,
        symbolName: codeEntity.symbolName,
        filePath: codeEntity.filePath,
        kind: codeEntity.kind,
        score: scoreExpr,
      })
      .from(codeFts)
      .innerJoin(codeEntity, eq(codeEntity.entityKey, codeFts.entityKey))
      .where(sql`${codeFts} MATCH ${input.query}`)
      .orderBy(scoreExpr)
      .limit(input.limit)
      .all() as Array<{ entityKey: string; symbolName: string | null; filePath: string; kind: string; score: number }>;

    return { results: rows ?? [] };
  } finally {
    deps.closeDb(db);
  }
}

async function getCodeEntityDefault(
  input: GetCodeEntityInput,
  deps: { createDb: typeof createDb; closeDb: typeof closeDb },
): Promise<GetCodeEntityResult> {
  const dbPath = zipbulCacheFilePath(input.projectRoot, 'index.sqlite');
  const db = deps.createDb(dbPath);

  try {
    const row = db
      .select({
        entityKey: codeEntity.entityKey,
        filePath: codeEntity.filePath,
        symbolName: codeEntity.symbolName,
        kind: codeEntity.kind,
        signature: codeEntity.signature,
        fingerprint: codeEntity.fingerprint,
        contentHash: codeEntity.contentHash,
        updatedAt: codeEntity.updatedAt,
      })
      .from(codeEntity)
      .where(eq(codeEntity.entityKey, input.entityKey))
      .limit(1)
      .get() as
      | {
          entityKey: string;
          filePath: string;
          symbolName: string | null;
          kind: string;
          signature: string | null;
          fingerprint: string | null;
          contentHash: string;
          updatedAt: string;
        }
      | undefined;

    return { entity: row ?? null };
  } finally {
    deps.closeDb(db);
  }
}

export interface ZipbulMcpContext {
  projectRoot: string;
  config: ResolvedZipbulConfig;
  role?: 'owner' | 'reader';
}

export interface ZipbulMcpDeps {
  indexProject?: typeof indexProject;
  searchCode?: (input: SearchCodeInput) => Promise<SearchCodeResult>;
  getCodeEntity?: (input: GetCodeEntityInput) => Promise<GetCodeEntityResult>;

  createDb?: typeof createDb;
  closeDb?: typeof closeDb;
}

export function createZipbulToolRegistry(_ctx: ZipbulMcpContext, deps?: ZipbulMcpDeps): ToolRegistry {
  const registry = new ToolRegistry();

  const ownerOnly = (ctx: ZipbulMcpContext) => ctx.role === 'owner';

  const indexProjectFn = deps?.indexProject ?? indexProject;

  const createDbFn = deps?.createDb ?? createDb;
  const closeDbFn = deps?.closeDb ?? closeDb;

  const searchCodeFn =
    deps?.searchCode ??
    ((input: SearchCodeInput) => searchCodeDefault(input, { createDb: createDbFn, closeDb: closeDbFn }));
  const getCodeEntityFn =
    deps?.getCodeEntity ??
    ((input: GetCodeEntityInput) => getCodeEntityDefault(input, { createDb: createDbFn, closeDb: closeDbFn }));


















  registry.register(
    declareTool({
      name: 'zipbul_index_project',
      title: 'Index project',
      description: 'Build or update the local SQLite index for MCP reads',
      shouldRegister: ownerOnly,
      inputSchema: {
        mode: z.enum(['full', 'incremental']).optional(),
      },
      run: async (ctx, input) => {
        const mode = (input as any)?.mode === 'full' ? 'full' : 'incremental';
        const dbPath = zipbulCacheFilePath(ctx.projectRoot, 'index.sqlite');
        const db = createDbFn(dbPath);
        try {
          return await indexProjectFn({
            projectRoot: ctx.projectRoot,
            config: ctx.config,
            db,
            mode,
          });
        } finally {
          closeDbFn(db);
        }
      },
    }),
  );

  registry.register(
    declareTool({
      name: 'zipbul_rebuild_index',
      title: 'Rebuild index',
      description: 'Rebuild the local SQLite index (defaults to full)',
      shouldRegister: ownerOnly,
      inputSchema: {
        mode: z.enum(['full', 'incremental']).optional(),
      },
      run: async (ctx, input) => {
        const mode = (input as any)?.mode === 'incremental' ? 'incremental' : 'full';
        const dbPath = zipbulCacheFilePath(ctx.projectRoot, 'index.sqlite');
        const db = createDbFn(dbPath);
        try {
          return await indexProjectFn({
            projectRoot: ctx.projectRoot,
            config: ctx.config,
            db,
            mode,
          });
        } finally {
          closeDbFn(db);
        }
      },
    }),
  );


  registry.register(
    declareTool({
      name: 'zipbul_search_code',
      title: 'Search code',
      description: 'Search code entities via the local SQLite FTS index',
      inputSchema: {
        query: z.string(),
        limit: z.number().int().positive().max(50).optional(),
      },
      run: async (ctx, input) => {
        const limit = clampLimit((input as any)?.limit, 10);
        return searchCodeFn({ projectRoot: ctx.projectRoot, query: String((input as any).query), limit });
      },
    }),
  );


  registry.register(
    declareTool({
      name: 'zipbul_get_code_entity',
      title: 'Get code entity',
      description: 'Get a code entity by entity_key from the local SQLite index',
      inputSchema: {
        entityKey: z.string(),
      },
      run: async (ctx, input) =>
        getCodeEntityFn({ projectRoot: ctx.projectRoot, entityKey: String((input as any).entityKey) }),
    }),
  );



  return registry;
}

export interface McpServerLike {
  registerTool: (name: string, config: unknown, cb: (args: unknown) => Promise<unknown>) => unknown;
  connect: (transport: unknown) => Promise<void>;
}

export interface StartZipbulMcpServerDeps extends ZipbulMcpDeps {
  createServer?: () => McpServerLike;
  createTransport?: () => unknown;

  createOwnerElection?: (input: { projectRoot: string; pid: number }) => { acquire: () => { role: 'owner' | 'reader' }; release: () => void };
  fileExists?: (path: string) => Promise<boolean>;
  subscribe?: (
    rootPath: string,
    cb: (err: Error | null, events: Array<{ type: string; path: string }>) => void,
    opts?: { ignore?: string[] },
  ) => Promise<{ unsubscribe: () => Promise<void> }>;

  createDb?: typeof createDb;
  closeDb?: typeof closeDb;
  loadConfig?: (projectRoot: string) => Promise<{ config: ResolvedZipbulConfig }>;
}

function toCallToolResult(structuredContent: unknown): unknown {
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

async function createDefaultServer(): Promise<McpServerLike> {
  const mod = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const server = new mod.McpServer({ name: 'zipbul', version: '0.0.1' });
  return server as unknown as McpServerLike;
}

async function createDefaultTransport(): Promise<unknown> {
  const mod = await import('@modelcontextprotocol/sdk/server/stdio.js');
  return new mod.StdioServerTransport();
}

export async function startZipbulMcpServerStdio(
  ctx: ZipbulMcpContext,
  deps?: StartZipbulMcpServerDeps,
): Promise<void> {
  const fileExists = deps?.fileExists ?? (async (path: string) => Bun.file(path).exists());
  const createDbFn = deps?.createDb ?? createDb;
  const closeDbFn = deps?.closeDb ?? closeDb;
  const indexProjectFn = deps?.indexProject ?? indexProject;

  const election = deps?.createOwnerElection
    ? deps.createOwnerElection({ projectRoot: ctx.projectRoot, pid: process.pid })
    : new OwnerElection({ projectRoot: ctx.projectRoot, pid: process.pid });
  const electionRes = election.acquire();
  ctx.role = electionRes.role;

  // Ensure index is ready (build if missing) — owner only.
  const dbPath = zipbulCacheFilePath(ctx.projectRoot, 'index.sqlite');
  if (electionRes.role === 'owner') {
    const exists = await fileExists(dbPath);
    if (!exists) {
      const db = createDbFn(dbPath);
      try {
        await indexProjectFn({ projectRoot: ctx.projectRoot, config: ctx.config as any, db: db as any, mode: 'full' });
      } finally {
        closeDbFn(db as any);
      }
    }
  }

  // Watch mode incremental re-index — owner only.
  if (electionRes.role === 'owner') {
    const subscribeFn = deps?.subscribe
      ? deps.subscribe
      : async (
          rootPath: string,
          cb: (err: Error | null, events: Array<{ type: string; path: string }>) => void,
          opts?: { ignore?: string[] },
        ) => {
          const mod = await import('@parcel/watcher');
          return (mod as any).subscribe(rootPath, cb, opts);
        };

    let queue = Promise.resolve();
    const enqueue = (fn: () => Promise<void>) => {
      queue = queue.then(fn).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[mcp] watch reindex failed: ${msg}`);
      });
    };

    const runReindex = async (mode: 'incremental' | 'full') => {
      const db = createDbFn(dbPath);
      try {
        await indexProjectFn({ projectRoot: ctx.projectRoot, config: ctx.config as any, db: db as any, mode });
      } finally {
        closeDbFn(db as any);
      }
    };

    const projectSubscription = await subscribeFn(
      ctx.projectRoot,
      (_err: Error | null, events: Array<{ type: string; path: string }>) => {
        for (const evt of events) {
          const relPath = relative(ctx.projectRoot, evt.path).replaceAll('\\', '/');
          if (relPath.startsWith('..')) continue;

          // Prevent indexing loops.
          if (relPath.startsWith('.zipbul/cache/') || relPath.startsWith('.zipbul/build/')) continue;

          const isConfig = relPath === 'zipbul.jsonc' || relPath === 'zipbul.json';
          const sourceDirRel = normalizeSourceDirRel(ctx.config.sourceDir);
          const isCode = relPath.startsWith(`${sourceDirRel}/`) && relPath.endsWith('.ts') && !relPath.endsWith('.d.ts');

          if (isConfig) {
            enqueue(async () => {
              const loader = deps?.loadConfig ?? (async () => ({ config: ctx.config }));
              const loaded = await loader(ctx.projectRoot);
              ctx.config = loaded.config;
              await runReindex('full');
            });
            continue;
          }

          if (isCode) {
            enqueue(async () => {
              await runReindex('incremental');
            });
          }
        }
      },
      {
        ignore: ['**/.git/**', '**/dist/**', '**/node_modules/**', '**/.zipbul/cache/**', '**/.zipbul/build/**'],
      },
    );

    const cacheDir = zipbulCacheDirPath(ctx.projectRoot);
    const signalPath = zipbulCacheFilePath(ctx.projectRoot, 'reindex.signal');
    const cacheSubscription = await subscribeFn(
      cacheDir,
      (_err: Error | null, events: Array<{ type: string; path: string }>) => {
        for (const evt of events) {
          if (evt.path !== signalPath) continue;
          enqueue(async () => {
            await runReindex('full');
          });
          break;
        }
      },
      {
        ignore: ['**/.git/**', '**/node_modules/**'],
      },
    );

    process.on('SIGINT', () => {
      void projectSubscription.unsubscribe();
      void cacheSubscription.unsubscribe();
      election.release();
    });
  }

  const server = deps?.createServer ? deps.createServer() : await createDefaultServer();
  const transport = deps?.createTransport ? deps.createTransport() : await createDefaultTransport();

  const registry = createZipbulToolRegistry(ctx, deps);

  for (const tool of registry.listForContext(ctx)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema as any,
      },
      async (args: unknown) => {
        const structured = await tool.run(ctx, args as any);
        return toCallToolResult(structured);
      },
    );
  }

  await server.connect(transport);
}
