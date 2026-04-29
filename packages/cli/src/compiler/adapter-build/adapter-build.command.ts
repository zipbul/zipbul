import { readFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { isErr } from '@zipbul/result';
import { parseSource, extractSymbols, extractRelations } from '@zipbul/gildash';
import type { ParsedFile, ExtractedSymbol, ExpressionValue, ExpressionCall, CodeRelation } from '@zipbul/gildash';

import { buildDiagnostic, DiagnosticError } from '../../diagnostics';

import type {
  AdapterConstructorSchema,
  AdapterManifest,
  BuildAdapterOptions,
  BuildAdapterResult,
  BuiltinEntry,
  BuiltinsManifest,
  ContextMethodSignature,
  ContextNamespacesSchema,
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
  const checkOnly = options.checkOnly === true;

  if (dryRun && checkOnly) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `--dry-run and --check-only are mutually exclusive.`,
    }));
  }

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
  const contextNamespaces = extractContextNamespaces(
    sourceTree,
    extracted.contextType,
    packageRoot,
  );
  const constructorSchema = extractAdapterConstructorSchema(
    sourceTree,
    extracted.adapterId,
    packageRoot,
  );
  const builtins = extractBuiltins(sourceTree, packageRoot);

  const pipelineSchemaRel = 'pipeline-schema.json';
  const decoratorSchemaRel = 'decorator-schema.json';
  const peerContractRel = 'peer-contract.json';
  const contextNamespacesRel = 'context-namespaces.json';
  const constructorSchemaRel = 'adapter-constructor-schema.json';
  const builtinsRel = 'builtins.json';
  const adapterManifest: AdapterManifest = {
    $schemaName: 'adapter.manifest',
    adapterId: extracted.adapterId,
    producedBy: PRODUCER_VERSION,
    manifests: {
      'pipeline-schema': pipelineSchemaRel,
      'decorator-schema': decoratorSchemaRel,
      'peer-contract': peerContractRel,
      'context-namespaces': contextNamespacesRel,
      'adapter-constructor-schema': constructorSchemaRel,
      'builtins': builtinsRel,
    },
  };

  const manifestPath = join(outDir, 'adapter.manifest.json');

  const artifacts: Array<{ readonly relPath: string; readonly content: string }> = [
    { relPath: pipelineSchemaRel, content: serializeJson(extracted.pipelineSchema) },
    { relPath: decoratorSchemaRel, content: serializeJson(decoratorSchema) },
    { relPath: peerContractRel, content: serializeJson(peerContract) },
    { relPath: contextNamespacesRel, content: serializeJson(contextNamespaces) },
    { relPath: constructorSchemaRel, content: serializeJson(constructorSchema) },
    { relPath: builtinsRel, content: serializeJson(builtins) },
    // Top-level manifest written last (Item 75) — indexes the other paths.
    { relPath: 'adapter.manifest.json', content: serializeJson(adapterManifest) },
  ];

  if (checkOnly) {
    await assertOnDiskMatches(outDir, artifacts);
    return { adapterId: extracted.adapterId, manifestPath, checked: true };
  }

  if (dryRun) {
    return { adapterId: extracted.adapterId, manifestPath };
  }

  // Atomic emit (Item 72·73·74): write to staging, then swap.
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });

  try {
    for (const artifact of artifacts) {
      await Bun.write(join(stagingDir, artifact.relPath), artifact.content);
    }

    await rm(outDir, { recursive: true, force: true });
    await rename(stagingDir, outDir);
  } catch (cause) {
    // Item 74 — failure leaves prior dist/ intact; just clean up staging.
    await rm(stagingDir, { recursive: true, force: true });
    throw cause;
  }

  return { adapterId: extracted.adapterId, manifestPath };
}

async function assertOnDiskMatches(
  outDir: string,
  artifacts: readonly { readonly relPath: string; readonly content: string }[],
): Promise<void> {
  if (!(await pathExists(outDir))) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `--check-only failed: ${outDir} does not exist. Run \`zb build adapter\` first.`,
      file: outDir,
    }));
  }

  for (const artifact of artifacts) {
    const filePath = join(outDir, artifact.relPath);

    if (!(await pathExists(filePath))) {
      throw new DiagnosticError(buildDiagnostic({
        reason: `--check-only failed: ${filePath} is missing — re-run the build.`,
        file: filePath,
      }));
    }

    const onDisk = await readFile(filePath, 'utf8');

    if (onDisk !== artifact.content) {
      throw new DiagnosticError(buildDiagnostic({
        reason: `--check-only failed: ${filePath} does not match the freshly produced manifest. The on-disk dist is stale or hand-edited.`,
        file: filePath,
      }));
    }
  }
}

interface ExtractedAdapterDefinition {
  readonly adapterId: string;
  readonly contextType: string;
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
  const contextType = readIdentifierField(adapterCall, 'context');

  if (phaseEnum === null || stepEnum === null) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `defineAdapter() in ${entry.filePath} must declare \`phase\` and \`step\` fields as enum identifier references.`,
      file: entry.filePath,
    }));
  }

  if (contextType === null) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `defineAdapter() in ${entry.filePath} must declare \`context\` field as a Context class identifier reference.`,
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
    contextType,
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

function extractContextNamespaces(
  tree: SourceTree,
  contextType: string,
  packageRoot: string,
): ContextNamespacesSchema {
  for (const file of tree) {
    for (const symbol of file.symbols) {
      if (symbol.kind !== 'class' || symbol.name !== contextType) continue;

      const methods: ContextMethodSignature[] = [];

      for (const member of symbol.members ?? []) {
        if (member.kind !== 'method') continue;
        if (member.modifiers.includes('private') || member.modifiers.includes('protected')) continue;
        if (member.methodKind !== 'method') continue; // skip getters/setters/constructor
        if (typeof member.name !== 'string' || member.name.length === 0) continue;

        const params = (member.parameters ?? []).map(p => ({
          name: p.name,
          type: p.type ?? null,
        }));

        methods.push({
          name: member.name,
          params,
          returnType: member.returnType ?? null,
        });
      }

      methods.sort((a, b) => a.name.localeCompare(b.name));

      return {
        $schemaName: 'adapter.context-namespaces',
        contextType,
        methods,
      };
    }
  }

  throw new DiagnosticError(buildDiagnostic({
    reason: `Context class \`${contextType}\` not found anywhere under ${packageRoot}/src/.`,
    file: packageRoot,
  }));
}

function extractAdapterConstructorSchema(
  tree: SourceTree,
  adapterId: string,
  packageRoot: string,
): AdapterConstructorSchema {
  for (const file of tree) {
    for (const symbol of file.symbols) {
      if (symbol.kind !== 'class' || symbol.name !== adapterId) continue;

      const ctor = (symbol.members ?? []).find(
        (m): m is ExtractedSymbol => m.kind === 'method' && m.methodKind === 'constructor',
      );

      if (ctor === undefined) {
        return {
          $schemaName: 'adapter.constructor-schema',
          optionsParam: null,
          optional: true,
        };
      }

      const params = ctor.parameters ?? [];
      const first = params[0];

      if (first === undefined) {
        return {
          $schemaName: 'adapter.constructor-schema',
          optionsParam: null,
          optional: true,
        };
      }

      // Item 44 — adapter constructors accept at most one options-object param.
      if (params.length > 1) {
        throw new DiagnosticError(buildDiagnostic({
          reason: `Adapter class \`${adapterId}\` (in ${file.filePath}) constructor must accept at most one options parameter (Item 44). Found ${params.length}.`,
          file: file.filePath,
        }));
      }

      return {
        $schemaName: 'adapter.constructor-schema',
        optionsParam: { name: first.name, type: first.type ?? null },
        optional: first.isOptional === true,
      };
    }
  }

  throw new DiagnosticError(buildDiagnostic({
    reason: `Adapter class \`${adapterId}\` not found while resolving constructor schema under ${packageRoot}/src/.`,
    file: packageRoot,
  }));
}

/**
 * Walks the package source tree for `defineMiddleware()` / `defineGuard()` /
 * `defineExceptionFilter()` calls bound to top-level exported variables
 * (Item 22·23·24·68). For middleware, also captures the optional
 * `[AdapterClass, ...]` first argument.
 */
function extractBuiltins(tree: SourceTree, packageRoot: string): BuiltinsManifest {
  const middlewares: BuiltinEntry[] = [];
  const guards: BuiltinEntry[] = [];
  const exceptionFilters: BuiltinEntry[] = [];

  const KIND_MAP: Record<string, BuiltinEntry['kind']> = {
    defineMiddleware: 'middleware',
    defineGuard: 'guard',
    defineExceptionFilter: 'exception-filter',
  };

  for (const file of tree) {
    const sourceFile = relativeFromRoot(file.filePath, packageRoot);

    for (const symbol of file.symbols) {
      if (symbol.kind !== 'variable' || !symbol.isExported) continue;

      const init = symbol.initializer;
      if (init === undefined || init.kind !== 'call') continue;

      const kind = KIND_MAP[init.callee];
      if (kind === undefined) continue;

      const adapters = kind === 'middleware'
        ? readAdaptersArrayArg(init)
        : [];

      const entry: BuiltinEntry = {
        exportName: symbol.name,
        sourceFile,
        kind,
        adapters,
      };

      if (kind === 'middleware') middlewares.push(entry);
      else if (kind === 'guard') guards.push(entry);
      else exceptionFilters.push(entry);
    }
  }

  // Stable sort for byte-identical output.
  const byExport = (a: BuiltinEntry, b: BuiltinEntry): number =>
    a.sourceFile.localeCompare(b.sourceFile) || a.exportName.localeCompare(b.exportName);
  middlewares.sort(byExport);
  guards.sort(byExport);
  exceptionFilters.sort(byExport);

  return {
    $schemaName: 'adapter.builtins',
    middlewares,
    guards,
    exceptionFilters,
  };
}

function readAdaptersArrayArg(call: ExpressionCall): readonly string[] {
  // `defineMiddleware([HttpAdapter], factory)` — adapters list is the first arg
  // and an array literal of identifiers. If the first arg is a function/object,
  // there's no adapter list (factory-only or config-object overload).
  const firstArg = call.arguments[0];
  if (firstArg === undefined) return [];
  if (firstArg.kind !== 'array') return [];

  const out: string[] = [];

  for (const element of firstArg.elements) {
    if (element.kind !== 'identifier') continue;
    out.push(element.name);
  }

  return out;
}

function relativeFromRoot(absPath: string, packageRoot: string): string {
  const root = packageRoot.endsWith('/') ? packageRoot : `${packageRoot}/`;
  return absPath.startsWith(root) ? absPath.slice(root.length) : absPath;
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
