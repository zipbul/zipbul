import type { ResolvedZipbulConfig } from '../../config';

import { join } from 'path';
import { mkdir } from 'node:fs/promises';

import { zipbulCardsGlobRel } from '../../common';
import { zipbulCacheDirPath, zipbulCacheFilePath } from '../../common/zipbul-paths';
import { closeDb, createDb, keyword, tag } from '../../store';

import { readCardFile } from '../card/card-fs';
import { parseFullKey } from '../card/card-key';

type Severity = 'error' | 'warning';

export type VerifyIssueCode =
  | 'CARD_KEY_DUPLICATE'
  | 'SEE_TARGET_MISSING'
  | 'SEE_KEY_INVALID'
  | 'CARD_KEY_INVALID'
  | 'CARD_CLASSIFICATION_NOT_REGISTERED'
  | 'RELATION_TARGET_MISSING'
  | 'RELATION_TYPE_NOT_ALLOWED'
  | 'IMPLEMENTED_CARD_NO_CODE_LINKS'
  | 'CONFIRMED_CARD_NO_CODE_LINKS'
  | 'DEPENDS_ON_CYCLE'
  | 'REFERENCES_DEPRECATED_CARD';

export interface VerifyIssue {
  severity: Severity;
  code: VerifyIssueCode;
  message: string;
  filePath?: string;
  cardKey?: string;
}

export interface VerifyProjectInput {
  projectRoot: string;
  config: ResolvedZipbulConfig;
}

export interface VerifyProjectResult {
  ok: boolean;
  errors: VerifyIssue[];
  warnings: VerifyIssue[];
}

function normalizeLowerSet(items: string[]): Set<string> {
  const out = new Set<string>();
  for (const item of items) {
    out.add(item.trim().toLowerCase());
  }
  return out;
}

async function loadRegisteredClassification(projectRoot: string): Promise<{ keywords: Set<string>; tags: Set<string> }> {
  const dbPath = zipbulCacheFilePath(projectRoot, 'index.sqlite');
  await mkdir(zipbulCacheDirPath(projectRoot), { recursive: true });

  const db = createDb(dbPath);
  try {
    const keywordRows = db.select({ name: keyword.name }).from(keyword).all() as Array<{ name: string }>;
    const tagRows = db.select({ name: tag.name }).from(tag).all() as Array<{ name: string }>;
    return {
      keywords: normalizeLowerSet(keywordRows.map((r) => r.name)),
      tags: normalizeLowerSet(tagRows.map((r) => r.name)),
    };
  } finally {
    closeDb(db);
  }
}

function toPosixPath(path: string): string {
  return path.replace(/\\/g, '/');
}

function normalizeSourceDirRel(sourceDir: string): string {
  const trimmed = sourceDir.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '').replace(/\/$/, '');
  return trimmed.length === 0 ? 'src' : trimmed;
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
    // eslint-disable-next-line no-await-in-loop
    const matches = await scanGlobRel(projectRoot, pattern);
    for (const rel of matches) {
      set.add(rel);
    }
  }
  return set;
}

function parseSeeCardKeysFromText(text: string): string[] {
  const out: string[] = [];
  const re = /@see\s+([^\s*]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push(m[1]!);
  }
  return Array.from(new Set(out));
}

function addIssue(issues: VerifyIssue[], issue: VerifyIssue) {
  issues.push(issue);
}

export async function verifyProject(input: VerifyProjectInput): Promise<VerifyProjectResult> {
  const { projectRoot, config } = input;

  const sourceDirRel = normalizeSourceDirRel(config.sourceDir);
  const excludeSet = await buildExcludeSet(projectRoot, config.mcp.exclude);

  const registered = await loadRegisteredClassification(projectRoot);

  const cardPathsRel = (await scanGlobRel(projectRoot, zipbulCardsGlobRel())).filter((p) => !excludeSet.has(p));
  const codePathsRel = (await scanGlobRel(projectRoot, `${sourceDirRel}/**/*.ts`)).filter((p) => !excludeSet.has(p));

  const errors: VerifyIssue[] = [];
  const warnings: VerifyIssue[] = [];

  // Parse cards from SSOT files.
  const cardByKey = new Map<
    string,
    {
      status: string;
      filePath: string;
      relations: Array<{ type: string; target: string }>;
      keywords: string[];
      tags: string[];
    }
  >();
  const duplicateCardKeys = new Map<string, string[]>();

  for (const relPath of cardPathsRel) {
    const absPath = join(projectRoot, relPath);
    // eslint-disable-next-line no-await-in-loop
    const parsed = await readCardFile(absPath);
    let key: string;
    try {
      key = parseFullKey(parsed.frontmatter.key);
    } catch {
      addIssue(errors, {
        severity: 'error',
        code: 'CARD_KEY_INVALID',
        filePath: relPath,
        cardKey: parsed.frontmatter.key,
        message: `Invalid card key: ${parsed.frontmatter.key}`,
      });
      continue;
    }

    const existing = cardByKey.get(key);
    if (existing) {
      const arr = duplicateCardKeys.get(key) ?? [existing.filePath];
      arr.push(relPath);
      duplicateCardKeys.set(key, arr);
      continue;
    }

    cardByKey.set(key, {
      status: parsed.frontmatter.status,
      filePath: relPath,
      relations: parsed.frontmatter.relations ?? [],
      keywords: parsed.frontmatter.keywords ?? [],
      tags: parsed.frontmatter.tags ?? [],
    });
  }

  for (const [key, files] of duplicateCardKeys.entries()) {
    addIssue(errors, {
      severity: 'error',
      code: 'CARD_KEY_DUPLICATE',
      cardKey: key,
      message: `Duplicate card key: ${key} (${files.join(', ')})`,
    });
  }

  const allowedRelationTypes = new Set(config.mcp.card.relations);

  for (const [key, c] of cardByKey.entries()) {
    const usedKeywords = c.keywords.map((k) => k.trim()).filter((k) => k.length > 0);
    const usedTags = c.tags.map((t) => t.trim()).filter((t) => t.length > 0);

    const missingKeywords = usedKeywords.filter((k) => !registered.keywords.has(k.toLowerCase()));
    const missingTags = usedTags.filter((t) => !registered.tags.has(t.toLowerCase()));

    if (missingKeywords.length > 0 || missingTags.length > 0) {
      const parts: string[] = [];
      if (missingKeywords.length > 0) parts.push(`keywords: ${missingKeywords.join(', ')}`);
      if (missingTags.length > 0) parts.push(`tags: ${missingTags.join(', ')}`);

      addIssue(errors, {
        severity: 'error',
        code: 'CARD_CLASSIFICATION_NOT_REGISTERED',
        cardKey: key,
        filePath: c.filePath,
        message: `Card uses unregistered classification (${parts.join(' | ')})`,
      });
    }

    for (const rel of c.relations) {
      if (!allowedRelationTypes.has(rel.type)) {
        addIssue(errors, {
          severity: 'error',
          code: 'RELATION_TYPE_NOT_ALLOWED',
          cardKey: key,
          filePath: c.filePath,
          message: `Relation type not allowed by config: ${rel.type}`,
        });
      }

      let targetKey: string;
      try {
        targetKey = parseFullKey(rel.target);
      } catch {
        addIssue(errors, {
          severity: 'error',
          code: 'RELATION_TARGET_MISSING',
          cardKey: key,
          filePath: c.filePath,
          message: `Relation target missing: ${rel.target}`,
        });
        continue;
      }

      const target = cardByKey.get(targetKey);
      if (!target) {
        addIssue(errors, {
          severity: 'error',
          code: 'RELATION_TARGET_MISSING',
          cardKey: key,
          filePath: c.filePath,
          message: `Relation target missing: ${targetKey}`,
        });
        continue;
      }
    }
  }

  // Scan code files for @see references.
  const seeRefsByCardKey = new Map<string, Set<string>>();

  for (const relPath of codePathsRel) {
    const absPath = join(projectRoot, relPath);
    // eslint-disable-next-line no-await-in-loop
    const text = await Bun.file(absPath).text();
    const rawKeys = parseSeeCardKeysFromText(text);

    for (const rawKey of rawKeys) {
      let key: string;
      try {
        key = parseFullKey(rawKey);
      } catch {
        addIssue(errors, {
          severity: 'error',
          code: 'SEE_KEY_INVALID',
          filePath: relPath,
          cardKey: rawKey,
          message: `@see key invalid: ${rawKey}`,
        });
        continue;
      }

      const card = cardByKey.get(key);
      if (!card) {
        addIssue(errors, {
          severity: 'error',
          code: 'SEE_TARGET_MISSING',
          filePath: relPath,
          message: `@see target card not found: ${key}`,
        });
        continue;
      }

      const set = seeRefsByCardKey.get(key) ?? new Set<string>();
      set.add(relPath);
      seeRefsByCardKey.set(key, set);
    }
  }

  // Card-centric link checks (implemented/accepted/implementing).
  for (const [key, c] of cardByKey.entries()) {
    const hasLinks = (seeRefsByCardKey.get(key)?.size ?? 0) > 0;
    if (c.status === 'implemented' && !hasLinks) {
      addIssue(errors, {
        severity: 'error',
        code: 'IMPLEMENTED_CARD_NO_CODE_LINKS',
        cardKey: key,
        filePath: c.filePath,
        message: `Implemented card has no @see code references: ${key}`,
      });
    }

    if ((c.status === 'accepted' || c.status === 'implementing') && !hasLinks) {
      addIssue(warnings, {
        severity: 'warning',
        code: 'CONFIRMED_CARD_NO_CODE_LINKS',
        cardKey: key,
        filePath: c.filePath,
        message: `Confirmed card has no @see code references: ${key}`,
      });
    }
  }

  // Soft rule: depends-on cycles.
  const dependsGraph = new Map<string, string[]>();
  for (const [key, c] of cardByKey.entries()) {
    const deps: string[] = [];
    for (const rel of c.relations) {
      if (rel.type !== 'depends-on') continue;
      try {
        deps.push(parseFullKey(rel.target));
      } catch {
        // ignore invalid targets for cycle detection; they are handled as errors elsewhere
      }
    }
    dependsGraph.set(key, deps);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();
  let cycleFound = false;

  const dfs = (node: string) => {
    if (cycleFound) return;
    visited.add(node);
    inStack.add(node);
    const next = dependsGraph.get(node) ?? [];
    for (const dst of next) {
      if (!cardByKey.has(dst)) continue;
      if (!visited.has(dst)) {
        dfs(dst);
      } else if (inStack.has(dst)) {
        cycleFound = true;
        return;
      }
    }
    inStack.delete(node);
  };

  for (const key of cardByKey.keys()) {
    if (!visited.has(key)) dfs(key);
    if (cycleFound) break;
  }

  if (cycleFound) {
    addIssue(warnings, {
      severity: 'warning',
      code: 'DEPENDS_ON_CYCLE',
      message: 'depends-on cycle detected',
    });
  }

  // Soft rule: references to deprecated cards (via relations or @see).
  const deprecatedKeys = new Set<string>();
  for (const [key, c] of cardByKey.entries()) {
    if (c.status === 'deprecated') deprecatedKeys.add(key);
  }

  if (deprecatedKeys.size > 0) {
    let referencedDeprecated = false;

    for (const [key, c] of cardByKey.entries()) {
      for (const rel of c.relations) {
        if (deprecatedKeys.has(rel.target)) {
          referencedDeprecated = true;
        }
      }

      if (deprecatedKeys.has(key) && (seeRefsByCardKey.get(key)?.size ?? 0) > 0) {
        referencedDeprecated = true;
      }
    }

    if (referencedDeprecated) {
      addIssue(warnings, {
        severity: 'warning',
        code: 'REFERENCES_DEPRECATED_CARD',
        message: 'References to deprecated cards detected',
      });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}
