import { readFile, mkdir, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { isErr } from '@zipbul/result';
import { parseSource, extractSymbols } from '@zipbul/gildash';
import type { ParsedFile, ExtractedSymbol, ExpressionValue, ExpressionCall } from '@zipbul/gildash';

import { buildDiagnostic, DiagnosticError } from '../../diagnostics';

import type { AdapterManifest, BuildAdapterOptions, BuildAdapterResult } from './interfaces';

const PRODUCER_VERSION = '@zipbul/cli@0.1.0';

/**
 * Compiles an adapter package into a `dist/` tree of manifests.
 *
 * Current implementation (Slice 1) emits only `dist/adapter.manifest.json`
 * with the adapter class identifier. Atomic emit via `.staging/` → `dist/`
 * rename (Item 72·73·74). Source resolution uses the package's `module`
 * field (interpreted as the source-tree entry — TS source path before
 * compilation) or `src/index.ts` as fallback.
 */
export async function buildAdapter(options: BuildAdapterOptions = {}): Promise<BuildAdapterResult> {
  const packageRoot = resolve(options.packageRoot ?? process.cwd());
  const outDir = resolve(packageRoot, options.outDir ?? 'dist');
  const stagingDir = `${outDir}.staging`;
  const dryRun = options.dryRun === true;

  const pkgJson = await readPackageJson(packageRoot);
  validateAdapterKind(pkgJson, packageRoot);

  const entrySourcePath = await resolveAdapterEntrySource(packageRoot, pkgJson);
  const adapterId = await extractAdapterId(entrySourcePath);

  const manifest: AdapterManifest = {
    $schemaName: 'adapter.manifest',
    adapterId,
    producedBy: PRODUCER_VERSION,
  };

  const manifestPath = join(outDir, 'adapter.manifest.json');

  if (!dryRun) {
    await rm(stagingDir, { recursive: true, force: true });
    await mkdir(stagingDir, { recursive: true });
    const stagingManifestPath = join(stagingDir, 'adapter.manifest.json');
    await Bun.write(stagingManifestPath, serializeManifest(manifest));

    await rm(outDir, { recursive: true, force: true });
    await rename(stagingDir, outDir);
  }

  return { adapterId, manifestPath };
}

interface AdapterPackageJson {
  readonly name?: string;
  readonly module?: string;
  readonly main?: string;
  readonly zipbul?: { readonly kind?: string };
}

async function readPackageJson(packageRoot: string): Promise<AdapterPackageJson> {
  const pkgPath = join(packageRoot, 'package.json');

  try {
    const text = await readFile(pkgPath, 'utf8');
    return JSON.parse(text) as AdapterPackageJson;
  } catch (cause) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `Failed to read ${pkgPath}: ${(cause as Error).message ?? String(cause)}`,
      file: pkgPath,
    }));
  }
}

function validateAdapterKind(pkg: AdapterPackageJson, packageRoot: string): void {
  if (pkg.zipbul?.kind !== 'adapter') {
    throw new DiagnosticError(buildDiagnostic({
      reason: `package.json at ${packageRoot} must declare "zipbul": { "kind": "adapter" }. Found: ${JSON.stringify(pkg.zipbul ?? null)}.`,
      file: join(packageRoot, 'package.json'),
    }));
  }
}

async function resolveAdapterEntrySource(packageRoot: string, _pkg: AdapterPackageJson): Promise<string> {
  // Slice 1: probe a conventional set of locations for the file that hosts the
  // top-level `defineAdapter()` call. Future slices follow the package's
  // re-export chain to locate the call from the published entry.
  const candidates = [
    'src/adapter-definition.ts',
    'src/adapter.ts',
    'src/index.ts',
    'index.ts',
  ];

  for (const rel of candidates) {
    const full = join(packageRoot, rel);
    const file = Bun.file(full);
    if (await file.exists()) {
      const text = await file.text();
      if (text.includes('defineAdapter')) return full;
    }
  }

  throw new DiagnosticError(buildDiagnostic({
    reason: `Adapter source entry not found (no file in [${candidates.join(', ')}] contains \`defineAdapter\`) under ${packageRoot}.`,
    file: packageRoot,
  }));
}

async function extractAdapterId(entryPath: string): Promise<string> {
  const sourceText = await readFile(entryPath, 'utf8');
  const parseResult = parseSource(entryPath, sourceText);

  if (isErr(parseResult)) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `Failed to parse adapter entry ${entryPath}: ${parseResult.data.message}`,
      file: entryPath,
    }));
  }

  const parsed: ParsedFile = parseResult;
  const symbols = extractSymbols(parsed);
  const adapterCall = findDefineAdapterCall(symbols);

  if (adapterCall === null) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `No \`defineAdapter()\` export found in ${entryPath}. The adapter package's source entry must export the result of \`defineAdapter({ adapter: SomeClass, ... })\`.`,
      file: entryPath,
    }));
  }

  const adapterId = readAdapterFieldIdentifier(adapterCall);

  if (adapterId === null) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `defineAdapter() in ${entryPath} must receive a config object whose \`adapter\` field is a class identifier reference.`,
      file: entryPath,
    }));
  }

  return adapterId;
}

function findDefineAdapterCall(symbols: readonly ExtractedSymbol[]): ExpressionCall | null {
  for (const symbol of symbols) {
    if (symbol.kind !== 'variable' || !symbol.isExported) continue;
    const init = symbol.initializer;

    if (init === undefined || init.kind !== 'call') continue;
    if (init.callee !== 'defineAdapter') continue;

    return init;
  }

  return null;
}

function readAdapterFieldIdentifier(call: ExpressionCall): string | null {
  const firstArg = call.arguments[0];

  if (firstArg === undefined || firstArg.kind !== 'object') return null;

  for (const prop of firstArg.properties) {
    if (prop.kind === 'spread') continue;
    if (prop.key.kind !== 'string' || prop.key.value !== 'adapter') continue;

    const value: ExpressionValue = prop.value;

    if (value.kind === 'identifier') return value.name;
  }

  return null;
}

function serializeManifest(manifest: AdapterManifest): string {
  // Canonical JSON: sorted keys, LF terminator, UTF-8 (Item 70).
  const ordered: Record<string, unknown> = {};
  const keys = Object.keys(manifest).sort();
  for (const key of keys) {
    ordered[key] = (manifest as unknown as Record<string, unknown>)[key];
  }
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
