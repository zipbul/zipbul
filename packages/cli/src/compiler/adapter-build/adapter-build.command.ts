import { readFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { isErr } from '@zipbul/result';
import { parseSource, extractSymbols, extractRelations } from '@zipbul/gildash';
import type { ParsedFile, ExtractedSymbol, ExpressionValue, ExpressionCall, CodeRelation } from '@zipbul/gildash';

import { buildDiagnostic, DiagnosticError } from '../../diagnostics';

import type {
  AdapterManifest,
  BuildAdapterOptions,
  BuildAdapterResult,
  DecoratorSchema,
  PeerContract,
  PipelineRef,
  PipelineSchema,
} from './interfaces';

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

  const sourceTree = await collectSourceTree(packageRoot);
  const entryFile = pickEntrySourceFile(sourceTree, packageRoot);
  const extracted = extractAdapterDefinition(entryFile);
  const decoratorSchema = extractDecoratorSchema(sourceTree, extracted.adapterId, packageRoot);
  const peerContract = extractPeerContract(
    sourceTree,
    extracted.adapterId,
    extracted.providesIdents,
    entryFile,
    packageRoot,
  );

  const pipelineSchemaRel = 'pipeline-schema.json';
  const decoratorSchemaRel = 'decorator-schema.json';
  const peerContractRel = 'peer-contract.json';
  const adapterManifest: AdapterManifest = {
    $schemaName: 'adapter.manifest',
    adapterId: extracted.adapterId,
    producedBy: PRODUCER_VERSION,
    manifests: {
      'pipeline-schema': pipelineSchemaRel,
      'decorator-schema': decoratorSchemaRel,
      'peer-contract': peerContractRel,
    },
  };

  const manifestPath = join(outDir, 'adapter.manifest.json');

  if (!dryRun) {
    await rm(stagingDir, { recursive: true, force: true });
    await mkdir(stagingDir, { recursive: true });

    await Bun.write(join(stagingDir, pipelineSchemaRel), serializeJson(extracted.pipelineSchema));
    await Bun.write(join(stagingDir, decoratorSchemaRel), serializeJson(decoratorSchema));
    await Bun.write(join(stagingDir, peerContractRel), serializeJson(peerContract));
    // Top-level manifest written last (Item 75): it indexes the other paths.
    await Bun.write(join(stagingDir, 'adapter.manifest.json'), serializeJson(adapterManifest));

    await rm(outDir, { recursive: true, force: true });
    await rename(stagingDir, outDir);
  }

  return { adapterId: extracted.adapterId, manifestPath };
}

interface ExtractedAdapterDefinition {
  readonly adapterId: string;
  readonly pipelineSchema: PipelineSchema;
  /** Identifier names from `defineAdapter({ provides: [...] })`, or empty when omitted. */
  readonly providesIdents: readonly string[];
}

/**
 * Cached `(filePath, parsed, symbols)` triples — every TS file in the package
 * source tree is parsed once and reused by all extractors that need to look
 * up classes/exports across files.
 */
interface SourceFile {
  readonly filePath: string;
  readonly parsed: ParsedFile;
  readonly symbols: readonly ExtractedSymbol[];
}

type SourceTree = readonly SourceFile[];

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

/**
 * Recursively collects every `.ts` file under `<packageRoot>/src/` (plus
 * any top-level `index.ts`) and parses each via gildash. Spec/test files
 * (`*.spec.ts`, `*.test.ts`) and the `dist/` tree are excluded — the
 * compiler operates on source only.
 */
async function collectSourceTree(packageRoot: string): Promise<SourceTree> {
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
    throw new DiagnosticError(buildDiagnostic({
      reason: `No TypeScript source files found in ${packageRoot}/src/ or ${packageRoot}/index.ts.`,
      file: packageRoot,
    }));
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
    throw new DiagnosticError(buildDiagnostic({
      reason: `Failed to parse ${filePath}: ${parseResult.data.message}`,
      file: filePath,
    }));
  }

  out.push({ filePath, parsed: parseResult, symbols: extractSymbols(parseResult) });
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function pickEntrySourceFile(tree: SourceTree, packageRoot: string): SourceFile {
  for (const file of tree) {
    if (findDefineAdapterCall(file.symbols) !== null) {
      return file;
    }
  }

  throw new DiagnosticError(buildDiagnostic({
    reason: `No file under ${packageRoot}/src/ exports a \`defineAdapter()\` call. The adapter package must export the result of \`defineAdapter({...})\`.`,
    file: packageRoot,
  }));
}

function extractAdapterDefinition(entry: SourceFile): ExtractedAdapterDefinition {
  const adapterCall = findDefineAdapterCall(entry.symbols);

  if (adapterCall === null) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `No \`defineAdapter()\` export found in ${entry.filePath}.`,
      file: entry.filePath,
    }));
  }

  const adapterId = readIdentifierField(adapterCall, 'adapter');

  if (adapterId === null) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `defineAdapter() in ${entry.filePath} must receive a config object whose \`adapter\` field is a class identifier reference.`,
      file: entry.filePath,
    }));
  }

  const phaseEnum = readIdentifierField(adapterCall, 'phase');
  const stepEnum = readIdentifierField(adapterCall, 'step');

  if (phaseEnum === null || stepEnum === null) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `defineAdapter() in ${entry.filePath} must declare \`phase\` and \`step\` fields as enum identifier references.`,
      file: entry.filePath,
    }));
  }

  const pipeline = readPipelineField(adapterCall);

  if (pipeline === null) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `defineAdapter() in ${entry.filePath} must declare a non-empty \`pipeline\` array of qualified enum members (e.g. \`HttpPhase.OnRequest\`, \`HttpStep.ResolveRoute\`, \`CoreStep.Handler\`).`,
      file: entry.filePath,
    }));
  }

  const providesIdents = readProvidesField(adapterCall);

  return {
    adapterId,
    pipelineSchema: {
      $schemaName: 'adapter.pipeline-schema',
      phaseEnum,
      stepEnum,
      pipeline,
    },
    providesIdents,
  };
}

function readProvidesField(call: ExpressionCall): readonly string[] {
  const firstArg = call.arguments[0];
  if (firstArg === undefined || firstArg.kind !== 'object') return [];

  for (const prop of firstArg.properties) {
    if (prop.kind === 'spread') continue;
    if (prop.key.kind !== 'string' || prop.key.value !== 'provides') continue;

    if (prop.value.kind !== 'array') return [];

    const out: string[] = [];

    for (const element of prop.value.elements) {
      if (element.kind !== 'identifier') continue;
      out.push(element.name);
    }

    return out;
  }

  return [];
}

/**
 * Builds `dist/peer-contract.json` from:
 * 1. The adapter class's `clusterStrategy` instance property (default: Shared).
 * 2. `defineAdapter({ provides })` field — already extracted into `providesIdents`.
 * 3. Source-tree-wide imports from `@zipbul/core` and `@zipbul/common` —
 *    the entire set of peer symbols the adapter actually uses.
 */
function extractPeerContract(
  tree: SourceTree,
  adapterId: string,
  providesIdents: readonly string[],
  _entryFile: SourceFile,
  packageRoot: string,
): PeerContract {
  const clusterStrategy = readClusterStrategy(tree, adapterId, packageRoot);
  const peerSymbols = collectPeerSymbols(tree);

  return {
    $schemaName: 'adapter.peer-contract',
    clusterStrategy,
    provides: providesIdents,
    peerSymbols,
  };
}

function readClusterStrategy(
  tree: SourceTree,
  adapterId: string,
  packageRoot: string,
): 'Shared' | 'Exclusive' {
  for (const file of tree) {
    for (const symbol of file.symbols) {
      if (symbol.kind !== 'class' || symbol.name !== adapterId) continue;

      const member = (symbol.members ?? []).find(
        (m): m is ExtractedSymbol => m.kind === 'property' && m.name === 'clusterStrategy',
      );

      if (member === undefined || member.initializer === undefined) {
        // Item 48b — missing → default Shared.
        return 'Shared';
      }

      const init = member.initializer;

      if (init.kind === 'member' && (init.property === 'Shared' || init.property === 'Exclusive')) {
        return init.property;
      }

      if (init.kind === 'string' && (init.value === 'Shared' || init.value === 'Exclusive')) {
        return init.value;
      }

      throw new DiagnosticError(buildDiagnostic({
        reason: `\`${adapterId}.clusterStrategy\` in ${file.filePath} must be \`ClusterStrategy.Shared\` or \`ClusterStrategy.Exclusive\` (or the equivalent string literal).`,
        file: file.filePath,
      }));
    }
  }

  throw new DiagnosticError(buildDiagnostic({
    reason: `Adapter class \`${adapterId}\` not found while resolving clusterStrategy under ${packageRoot}/src/.`,
    file: packageRoot,
  }));
}

function collectPeerSymbols(tree: SourceTree): { [packageName: string]: readonly string[] } {
  const PEER_PACKAGES = new Set(['@zipbul/core', '@zipbul/common']);
  const collected = new Map<string, Set<string>>();

  for (const pkg of PEER_PACKAGES) {
    collected.set(pkg, new Set());
  }

  for (const file of tree) {
    const relations: readonly CodeRelation[] = extractRelations(file.parsed.program, file.filePath);

    for (const rel of relations) {
      if (rel.type !== 'imports' && rel.type !== 'type-references') continue;
      if (rel.specifier === undefined) continue;
      if (!PEER_PACKAGES.has(rel.specifier)) continue;
      if (rel.dstSymbolName === null || rel.dstSymbolName === '*') continue;

      collected.get(rel.specifier)!.add(rel.dstSymbolName);
    }
  }

  const out: { [packageName: string]: readonly string[] } = {};

  for (const [pkg, symbols] of collected) {
    out[pkg] = [...symbols].sort();
  }

  return out;
}

/**
 * Locates the adapter class by name across the source tree, then reads its
 * `decorators` instance property to derive the controller / handlers /
 * options identifiers (Item 19·20·21·67).
 */
function extractDecoratorSchema(
  tree: SourceTree,
  adapterId: string,
  packageRoot: string,
): DecoratorSchema {
  for (const file of tree) {
    for (const symbol of file.symbols) {
      if (symbol.kind !== 'class' || symbol.name !== adapterId) continue;

      const decoratorsMember = (symbol.members ?? []).find(
        (m): m is ExtractedSymbol => m.kind === 'property' && m.name === 'decorators',
      );

      if (decoratorsMember === undefined || decoratorsMember.initializer === undefined) {
        throw new DiagnosticError(buildDiagnostic({
          reason: `Adapter class \`${adapterId}\` in ${file.filePath} must declare a \`decorators\` instance property of shape \`{ controller, handlers, options? }\`.`,
          file: file.filePath,
        }));
      }

      return readAdapterEntryDecorators(decoratorsMember.initializer, file.filePath, adapterId);
    }
  }

  throw new DiagnosticError(buildDiagnostic({
    reason: `Adapter class \`${adapterId}\` not found anywhere under ${packageRoot}/src/.`,
    file: packageRoot,
  }));
}

function readAdapterEntryDecorators(
  init: ExpressionValue,
  filePath: string,
  adapterId: string,
): DecoratorSchema {
  if (init.kind !== 'object') {
    throw new DiagnosticError(buildDiagnostic({
      reason: `Adapter class \`${adapterId}\` (in ${filePath}) decorators property must be an object literal.`,
      file: filePath,
    }));
  }

  let controller: string | null = null;
  let handlers: readonly string[] | null = null;
  let options: readonly string[] = [];

  for (const prop of init.properties) {
    if (prop.kind === 'spread') continue;
    if (prop.key.kind !== 'string') continue;

    const fieldName = prop.key.value;

    if (fieldName === 'controller') {
      if (prop.value.kind !== 'identifier') {
        throw new DiagnosticError(buildDiagnostic({
          reason: `decorators.controller in ${filePath} must be a single identifier reference (Item 41 — exactly 1).`,
          file: filePath,
        }));
      }
      controller = prop.value.name;
    } else if (fieldName === 'handlers') {
      handlers = readIdentifierArray(prop.value, 'decorators.handlers', filePath);

      if (handlers.length === 0) {
        throw new DiagnosticError(buildDiagnostic({
          reason: `decorators.handlers in ${filePath} must contain at least one identifier reference (Item 41 — 1+).`,
          file: filePath,
        }));
      }
    } else if (fieldName === 'options') {
      options = readIdentifierArray(prop.value, 'decorators.options', filePath);
    }
  }

  if (controller === null) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `decorators.controller missing in ${filePath} (Item 41).`,
      file: filePath,
    }));
  }

  if (handlers === null) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `decorators.handlers missing in ${filePath} (Item 41).`,
      file: filePath,
    }));
  }

  ensureUnique([controller, ...handlers, ...options], filePath);

  return {
    $schemaName: 'adapter.decorator-schema',
    controller,
    handlers,
    options,
  };
}

function readIdentifierArray(value: ExpressionValue, label: string, filePath: string): readonly string[] {
  if (value.kind !== 'array') {
    throw new DiagnosticError(buildDiagnostic({
      reason: `${label} in ${filePath} must be an array literal of identifier references.`,
      file: filePath,
    }));
  }

  const out: string[] = [];

  for (const element of value.elements) {
    if (element.kind !== 'identifier') {
      throw new DiagnosticError(buildDiagnostic({
        reason: `${label} in ${filePath} must contain only identifier references (no spreads, calls, or literals).`,
        file: filePath,
      }));
    }
    out.push(element.name);
  }

  return out;
}

function ensureUnique(names: readonly string[], filePath: string): void {
  // Item 40 — decorator name uniqueness within the controller/handlers/options
  // grouping for the adapter entry.
  const seen = new Set<string>();
  const dupes = new Set<string>();

  for (const name of names) {
    if (seen.has(name)) dupes.add(name);
    seen.add(name);
  }

  if (dupes.size > 0) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `Duplicate decorator name(s) [${[...dupes].join(', ')}] in ${filePath} (Item 40).`,
      file: filePath,
    }));
  }
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

function readIdentifierField(call: ExpressionCall, fieldName: string): string | null {
  const firstArg = call.arguments[0];

  if (firstArg === undefined || firstArg.kind !== 'object') return null;

  for (const prop of firstArg.properties) {
    if (prop.kind === 'spread') continue;
    if (prop.key.kind !== 'string' || prop.key.value !== fieldName) continue;

    const value: ExpressionValue = prop.value;

    if (value.kind === 'identifier') return value.name;
  }

  return null;
}

function readPipelineField(call: ExpressionCall): readonly PipelineRef[] | null {
  const firstArg = call.arguments[0];

  if (firstArg === undefined || firstArg.kind !== 'object') return null;

  for (const prop of firstArg.properties) {
    if (prop.kind === 'spread') continue;
    if (prop.key.kind !== 'string' || prop.key.value !== 'pipeline') continue;

    if (prop.value.kind !== 'array') return null;

    const refs: PipelineRef[] = [];

    for (const element of prop.value.elements) {
      if (element.kind !== 'member') return null;

      refs.push({ qualifier: element.object, name: element.property });
    }

    if (refs.length === 0) return null;

    return refs;
  }

  return null;
}

function serializeJson(value: unknown): string {
  // Canonical JSON: sorted keys (recursive), LF terminator, UTF-8 (Item 70).
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value !== null && typeof value === 'object') {
    const ordered: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort();
    for (const key of keys) {
      ordered[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return ordered;
  }

  return value;
}
