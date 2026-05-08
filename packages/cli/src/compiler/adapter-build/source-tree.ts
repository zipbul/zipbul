import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { isErr } from '@zipbul/result';
import { extractSymbols, parseSource } from '@zipbul/gildash';
import type { ExpressionCall, ExtractedSymbol, ParsedFile } from '@zipbul/gildash';

import { buildCalleeResolver } from '../define-call-shape';

import { diag } from './diag';

/**
 * Cached `(filePath, parsed, symbols)` triple — every TS file in the package
 * source tree is parsed once and reused by all extractors.
 */
export interface SourceFile {
  readonly filePath: string;
  readonly parsed: ParsedFile;
  readonly symbols: readonly ExtractedSymbol[];
}

export type SourceTree = readonly SourceFile[];

export async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Recursively collects every `.ts` file under `<packageRoot>/src/` (plus any
 * top-level `index.ts`) and parses each via gildash. Spec/test files and the
 * `dist/` tree are excluded — the compiler operates on source only.
 */
export async function collectSourceTree(packageRoot: string): Promise<SourceTree> {
  const tree: SourceFile[] = [];
  const srcDir = join(packageRoot, 'src');

  if (await pathExists(srcDir)) {
    await walkSourceTree(srcDir, tree);
  }

  const topLevelIndex = join(packageRoot, 'index.ts');

  if (await pathExists(topLevelIndex)) {
    await pushSourceFile(topLevelIndex, tree);
  }

  if (tree.length === 0) {
    throw diag('CONTRACT', {
      reason: `No TypeScript source files found in ${packageRoot}/src/ or ${packageRoot}/index.ts.`,
      file: packageRoot,
      how: 'Create your adapter source under `src/` (e.g. `src/index.ts`) or place an `index.ts` at the package root.',
    });
  }

  return tree;
}

async function walkSourceTree(dir: string, out: SourceFile[]): Promise<void> {
  const entries = await readdir(dir);

  for (const entry of entries) {
    const full = join(dir, entry);
    const info = await stat(full);

    if (info.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '.zipbul') continue;
      await walkSourceTree(full, out);
      continue;
    }

    if (!info.isFile()) continue;
    if (!full.endsWith('.ts')) continue;
    if (full.endsWith('.spec.ts') || full.endsWith('.test.ts')) continue;
    if (full.endsWith('.d.ts')) continue;

    await pushSourceFile(full, out);
  }
}

async function pushSourceFile(filePath: string, out: SourceFile[]): Promise<void> {
  const text = await readFile(filePath, 'utf8');
  const parseResult = parseSource(filePath, text);

  if (isErr(parseResult)) {
    throw diag('SYNTAX', {
      reason: `Failed to parse ${filePath}: ${parseResult.data.message}`,
      file: filePath,
    });
  }

  out.push({
    filePath,
    parsed: parseResult,
    symbols: extractSymbols(parseResult),
  });
}

export function pickEntrySourceFile(tree: SourceTree, packageRoot: string): SourceFile {
  const matches: SourceFile[] = [];

  for (const file of tree) {
    if (findDefineAdapterCall(file.symbols, file) !== null) {
      matches.push(file);
    }
  }

  if (matches.length === 0) {
    throw diag('MISSING_EXPORT', {
      reason: `No file under ${packageRoot}/src/ exports a \`defineAdapter()\` call. The adapter package must export the result of \`defineAdapter({...})\`.`,
      file: packageRoot,
      how: 'Create exactly one `export const adapterDefinition = defineAdapter({...})` in your adapter source tree.',
    });
  }

  if (matches.length > 1) {
    const list = matches.map(m => m.filePath).join(', ');
    throw diag('DUPLICATE', {
      reason: `Multiple \`defineAdapter()\` calls found in adapter package (${list}). Exactly one is required.`,
      file: packageRoot,
      how: 'Consolidate the adapter definition into a single `defineAdapter({...})` call exported from one source file.',
    });
  }

  return matches[0]!;
}

export function relativeFromRoot(absPath: string, packageRoot: string): string {
  const root = packageRoot.endsWith('/') ? packageRoot : `${packageRoot}/`;
  return absPath.startsWith(root) ? absPath.slice(root.length) : absPath;
}

/**
 * Locates the unique `export const X = defineAdapter({...})` call in a
 * source file. Lives here (not in parse-helpers) so source-tree's
 * `pickEntrySourceFile` doesn't drag in a circular import.
 */
export function findDefineAdapterCall(
  symbols: readonly ExtractedSymbol[],
  entry: SourceFile,
): { call: ExpressionCall; symbol: ExtractedSymbol } | null {
  const resolver = buildCalleeResolver({ filePath: entry.filePath, parsed: entry.parsed });
  for (const symbol of symbols) {
    if (symbol.kind !== 'variable' || !symbol.isExported) continue;
    const init = symbol.initializer;

    if (init === undefined || init.kind !== 'call') continue;
    if (resolver.resolveCalleeText(init.callee) !== 'defineAdapter') continue;

    return { call: init, symbol };
  }

  return null;
}
