import { readFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';

import { isErr } from '@zipbul/result';
import { parseSource, extractSymbols, extractRelations } from '@zipbul/gildash';
import { validateDefineCallShape } from '../define-call-shape';
import type { ParsedFile, ExtractedSymbol, ExpressionValue, ExpressionCall, CodeRelation } from '@zipbul/gildash';

import { buildDiagnostic, DiagnosticError } from '../../diagnostics';

/**
 * Adapter-build diagnostic category (Item 80). Prefixed onto the diagnostic's
 * `reason` so downstream tooling can filter without depending on a separate
 * field in the shared `Diagnostic` shape.
 */
type DiagnosticCategory = 'SYNTAX' | 'CONTRACT' | 'MISSING_EXPORT' | 'DUPLICATE' | 'TYPE' | 'IO';

function diag(
  category: DiagnosticCategory,
  params: {
    reason: string;
    file?: string;
    symbol?: string;
    how?: string;
    /** Item 79 — pre-resolved line/column from gildash `ExtractedSymbol.span`. */
    position?: { line: number; column: number };
  },
): DiagnosticError {
  let position = '';
  if (params.position !== undefined) {
    position = ` at ${params.file ?? '<source>'}:${params.position.line}:${params.position.column}`;
  }
  const taggedReason = `[${category}] ${params.reason}${position}`;

  const built = buildDiagnostic({
    reason: taggedReason,
    ...(params.file !== undefined ? { file: params.file } : {}),
    ...(params.symbol !== undefined ? { symbol: params.symbol } : {}),
    ...(params.how !== undefined ? { how: params.how } : {}),
  });

  return new DiagnosticError(built);
}

import type {
  AdapterConstructorSchema,
  AdapterManifest,
  BuildAdapterOptions,
  BuildAdapterResult,
  ContextMethodSignature,
  ContextNamespaceProperty,
  ContextNamespacesSchema,
  DecoratorSchema,
  PeerContract,
  PipelineRef,
  PipelineSchema,
} from './interfaces';

/**
 * Compiles an adapter package into a `dist/` tree of manifests + JS/d.ts.
 * Atomic emit via `.staging/` → `dist/` rename (Item 72·73·74). Source
 * resolution uses the package's `module` field (TS source-tree entry) or
 * `src/index.ts` as fallback.
 */
export async function buildAdapter(options: BuildAdapterOptions = {}): Promise<BuildAdapterResult> {
  const packageRoot = resolve(options.packageRoot ?? process.cwd());
  const outDir = resolve(packageRoot, 'dist');
  const stagingDir = `${outDir}.staging`;

  const pkgJson = await readPackageJson(packageRoot);
  validateAdapterKind(pkgJson, packageRoot);

  const sourceTree = await collectSourceTree(packageRoot);
  validateDefineCallShape(sourceTree.map(f => ({ filePath: f.filePath, parsed: f.parsed })));
  const entryFile = pickEntrySourceFile(sourceTree, packageRoot);
  const extracted = extractAdapterDefinition(entryFile);

  // Item 82 — collect validators' diagnostics rather than stopping at the
  // first failure. Each validator either returns silently or throws a
  // DiagnosticError; we aggregate before re-throwing.
  const collected: DiagnosticError[] = [];
  const collectFrom = (fn: () => void): void => {
    try { fn(); } catch (cause) {
      if (cause instanceof DiagnosticError) {
        collected.push(cause);
      } else {
        throw cause;
      }
    }
  };
  collectFrom(() => validatePackageFields(pkgJson, packageRoot));
  collectFrom(() => validatePipeline(sourceTree, extracted, entryFile.filePath));
  collectFrom(() => validateClassExports(sourceTree, extracted, packageRoot));

  if (collected.length > 0) {
    if (collected.length === 1) throw collected[0]!;

    const lines = collected.map(e => `  - ${e.diagnostic.why}`).join('\n');
    throw diag('CONTRACT', {
      reason: `${collected.length} validation errors:\n${lines}`,
      file: packageRoot,
    });
  }
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
  validateNoBuiltinMiddleware(sourceTree, packageRoot);

  const pipelineSchemaRel = 'pipeline-schema.json';
  const decoratorSchemaRel = 'decorator-schema.json';
  const peerContractRel = 'peer-contract.json';
  const contextNamespacesRel = 'context-namespaces.json';
  const constructorSchemaRel = 'adapter-constructor-schema.json';

  const phaseMembers = resolveEnumMembers(sourceTree, extracted.pipelineSchema.phaseEnum);
  const stepMembers = resolveEnumMembers(sourceTree, extracted.pipelineSchema.stepEnum);
  const pipelineSchema: PipelineSchema = {
    ...extracted.pipelineSchema,
    phaseMembers: phaseMembers === null ? [] : [...phaseMembers],
    stepMembers: stepMembers === null ? [] : [...stepMembers],
  };

  const childArtifacts: Array<{ readonly relPath: string; readonly content: string }> = [
    { relPath: pipelineSchemaRel, content: serializeJson(pipelineSchema) },
    { relPath: decoratorSchemaRel, content: serializeJson(decoratorSchema) },
    { relPath: peerContractRel, content: serializeJson(peerContract) },
    { relPath: contextNamespacesRel, content: serializeJson(contextNamespaces) },
    { relPath: constructorSchemaRel, content: serializeJson(constructorSchema) },
  ];

  const adapterManifest: AdapterManifest = {
    $schemaName: 'adapter.manifest',
    adapterId: extracted.adapterId,
    manifests: {
      'pipeline-schema': pipelineSchemaRel,
      'decorator-schema': decoratorSchemaRel,
      'peer-contract': peerContractRel,
      'context-namespaces': contextNamespacesRel,
      'adapter-constructor-schema': constructorSchemaRel,
    },
  };

  const manifestPath = join(outDir, 'adapter.manifest.json');

  const artifacts: Array<{ readonly relPath: string; readonly content: string }> = [
    ...childArtifacts,
    // Top-level manifest written last (Item 75) — indexes the other paths.
    { relPath: 'adapter.manifest.json', content: serializeJson(adapterManifest) },
  ];

  // Atomic emit (Item 72·73·74): write to staging, then swap.
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });

  try {
    for (const artifact of artifacts) {
      await Bun.write(join(stagingDir, artifact.relPath), artifact.content);
    }

    await runCodegen(packageRoot, stagingDir);

    await rm(outDir, { recursive: true, force: true });
    await rename(stagingDir, outDir);
  } catch (cause) {
    // Item 74 — failure leaves prior dist/ intact; just clean up staging.
    await rm(stagingDir, { recursive: true, force: true });
    throw cause;
  }

  return { adapterId: extracted.adapterId, manifestPath };
}

/**
 * Runs the TS → JS bundle (`Bun.build`) and `tsc --emitDeclarationOnly`
 * into the staging directory (Item 55·56·57·87·88·89·90).
 *
 * The published entrypoint is conventionally `<packageRoot>/index.ts` (the
 * barrel), not the `defineAdapter()`-bearing file. If absent, falls back to
 * `<packageRoot>/src/index.ts`.
 *
 * `.d.ts` emission is best-effort: when a `tsconfig.build.json` is present
 * at the package root we invoke `tsc` against it with `--outDir <staging>`;
 * otherwise we skip and leave it to the package's own build pipeline.
 */
async function runCodegen(packageRoot: string, stagingDir: string): Promise<void> {
  const entryCandidates = ['index.ts', 'src/index.ts'];
  let entryPath: string | null = null;

  for (const rel of entryCandidates) {
    const full = join(packageRoot, rel);
    if (await pathExists(full)) {
      entryPath = full;
      break;
    }
  }

  if (entryPath === null) {
    // Adapter packages without a published entrypoint (e.g. internal-only
    // fixtures) still get manifest emission; codegen simply skips. Later
    // slices will tighten this against package.json.main/module (Item 45).
    return;
  }

  // 1. JS bundle via Bun.build — same shape the package's own scripts use.
  //
  // `minify: { syntax, whitespace }` matches the existing convention shared by
  // the in-tree adapter build scripts (`bun build ... --minify-syntax
  // --minify-whitespace`). `identifiers: false` keeps exported names readable
  // for runtime introspection — the manifest references identifiers by name.
  const buildResult = await Bun.build({
    entrypoints: [entryPath],
    outdir: stagingDir,
    target: 'bun',
    format: 'esm',
    packages: 'external',
    minify: {
      syntax: true,
      whitespace: true,
      identifiers: false,
    },
  });

  if (!buildResult.success) {
    const messages = buildResult.logs.map(l => l.message).join('\n  ');
    throw diag('IO', {
      reason: `Bun.build failed for ${entryPath}:\n  ${messages}`,
      file: entryPath,
    });
  }

  // 2. .d.ts via tsc — only when the package ships a tsconfig.build.json.
  const tsconfigBuildPath = join(packageRoot, 'tsconfig.build.json');

  if (await pathExists(tsconfigBuildPath)) {
    await runTsc(packageRoot, tsconfigBuildPath, stagingDir);
  }
}

async function runTsc(packageRoot: string, tsconfigPath: string, outDir: string): Promise<void> {
  const tscBin = await resolveTscBin(packageRoot);
  // Item 93 — pin tsbuildinfo to .zipbul/cache/<package>.tsbuildinfo so
  // composite/incremental builds reuse a stable cache across invocations.
  const cacheDir = join(packageRoot, '.zipbul', 'cache');
  await mkdir(cacheDir, { recursive: true });
  const pkgName = (await readPackageJson(packageRoot)).name ?? 'adapter';
  const safePkgName = pkgName.replace(/[^\w.-]+/g, '_');
  const tsBuildInfoFile = join(cacheDir, `${safePkgName}.tsbuildinfo`);

  const baseArgs = [
    '-p', tsconfigPath,
    '--outDir', outDir,
    '--tsBuildInfoFile', tsBuildInfoFile,
  ];

  // Item 92 — when the project uses composite/references, tsc requires
  // `--build` mode. We probe the tsconfig for `composite` or `references`
  // and switch invocation accordingly.
  const buildMode = await tsconfigNeedsBuildMode(tsconfigPath);
  const args = buildMode
    ? (tscBin === 'bunx'
      ? ['tsc', '--build', tsconfigPath, '--force']
      : ['--build', tsconfigPath, '--force'])
    : (tscBin === 'bunx'
      ? ['tsc', ...baseArgs]
      : baseArgs);

  await new Promise<void>((resolveFn, rejectFn) => {
    const child = spawn(tscBin, args, {
      cwd: packageRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let stdout = '';

    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });

    child.on('error', rejectFn);
    child.on('close', code => {
      if (code === 0) {
        resolveFn();
        return;
      }

      const message = stderr.trim() !== '' ? stderr.trim() : stdout.trim();

      rejectFn(diag('IO', {
        reason: `tsc exited with code ${code} for ${tsconfigPath}:\n${message}`,
        file: tsconfigPath,
      }));
    });
  });
}

/**
 * Item 92 — detect whether the tsconfig forces `--build` mode. Returns true
 * when the JSON declares `compilerOptions.composite: true` or a non-empty
 * `references` array. We do a shallow JSON parse only; following `extends`
 * chains is left for a future slice.
 */
async function tsconfigNeedsBuildMode(tsconfigPath: string): Promise<boolean> {
  try {
    const text = await readFile(tsconfigPath, 'utf8');
    // tsconfig allows comments + trailing commas; tolerate via stripped JSON.
    const stripped = text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/[^\n]*/g, '$1')
      .replace(/,(\s*[}\]])/g, '$1');
    const parsed = JSON.parse(stripped) as {
      compilerOptions?: { composite?: boolean };
      references?: readonly unknown[];
    };
    if (parsed.compilerOptions?.composite === true) return true;
    if (Array.isArray(parsed.references) && parsed.references.length > 0) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Resolves a usable `tsc` executable.
 *
 * Walk up from `packageRoot` looking for `node_modules/.bin/tsc` — the
 * monorepo's hoisted dev-dependency typically lives at the workspace root.
 * Falls back to `bunx tsc` (which itself resolves via the bun cache) when no
 * local install is found.
 */
async function resolveTscBin(packageRoot: string): Promise<string> {
  let dir = packageRoot;
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, 'node_modules', '.bin', 'tsc');
    if (await pathExists(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return 'bunx';
}


interface ExtractedAdapterDefinition {
  readonly adapterId: string;
  readonly contextType: string;
  /**
   * Pipeline schema *before* enum-member resolution. The `phaseMembers` /
   * `stepMembers` fields are filled later in the build flow once the source
   * tree has been walked (`resolveEnumMembers`).
   */
  readonly pipelineSchema: Omit<PipelineSchema, 'phaseMembers' | 'stepMembers'>;
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
  readonly version?: string;
  readonly main?: string;
  readonly module?: string;
  readonly types?: string;
  readonly exports?: unknown;
  readonly files?: readonly string[];
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly zipbul?: { readonly kind?: string };
}

async function readPackageJson(packageRoot: string): Promise<AdapterPackageJson> {
  const pkgPath = join(packageRoot, 'package.json');

  try {
    const text = await readFile(pkgPath, 'utf8');
    return JSON.parse(text) as AdapterPackageJson;
  } catch (cause) {
    throw diag('IO', {
      reason: `Failed to read ${pkgPath}: ${(cause as Error).message ?? String(cause)}`,
      file: pkgPath,
    });
  }
}

function validateAdapterKind(pkg: AdapterPackageJson, packageRoot: string): void {
  if (pkg.zipbul?.kind !== 'adapter') {
    throw diag('CONTRACT', {
      reason: `package.json at ${packageRoot} must declare "zipbul": { "kind": "adapter" }. Found: ${JSON.stringify(pkg.zipbul ?? null)}.`,
      file: join(packageRoot, 'package.json'),
    });
  }
}

/**
 * Item 45·46. Validates that the published entry points are coherent and
 * that peer dependencies are listed (not bundled).
 *
 * - `main` / `module` / `types` / `exports['.']` must converge: when both a
 *   `module` and an `exports['.']` import condition exist, they must match.
 *   `types` must point at a `.d.ts`.
 * - `files` must include `dist` (or `dist/**`) so the published tarball
 *   carries the compiler output.
 * - `peerDependencies` SHOULD list `@zipbul/core` and `@zipbul/common`
 *   (the runtime contract). Missing → WARN-equivalent CONTRACT diagnostic.
 *   We escalate to error when the package additionally pulls them in via
 *   `dependencies` (would bundle two copies).
 */
function validatePackageFields(pkg: AdapterPackageJson, packageRoot: string): void {
  // Item 82 — collect every issue inside this validator, throw aggregated.
  const pkgPath = join(packageRoot, 'package.json');
  const errors: string[] = [];

  if (typeof pkg.types === 'string' && !pkg.types.endsWith('.d.ts')) {
    errors.push(`package.json \`types\` must point at a \`.d.ts\` file. Got: ${pkg.types}.`);
  }

  const moduleEntry = typeof pkg.module === 'string' ? normalizeRelative(pkg.module) : null;
  const exportsImport = readExportsDefault(pkg.exports);
  const exportsImportNormalized = exportsImport !== null ? normalizeRelative(exportsImport) : null;

  if (moduleEntry !== null && exportsImportNormalized !== null && exportsImportNormalized !== moduleEntry) {
    errors.push(`package.json \`module\` (${pkg.module}) and \`exports['.']\` default (${exportsImport}) must resolve to the same path.`);
  }

  if (Array.isArray(pkg.files)) {
    const includesDist = pkg.files.some(entry =>
      entry === 'dist' || entry === 'dist/' || entry.startsWith('dist/'),
    );

    if (!includesDist) {
      errors.push(`package.json \`files\` must include \`dist\` so the compiled output ships in the published tarball. Got: ${JSON.stringify(pkg.files)}.`);
    }
  }

  // Item 6·46 — framework runtime declarations. Skip when the fixture
  // package.json declares no deps at all (minimal/test packages); enforce
  // only when the package has any dependency or peerDependency, signaling
  // intent to publish.
  const peerDeps = pkg.peerDependencies ?? {};
  const directDeps = pkg.dependencies ?? {};
  const declaresAnyDeps = Object.keys(peerDeps).length > 0 || Object.keys(directDeps).length > 0;

  if (declaresAnyDeps) {
    const requiredFrameworkPeers = ['@zipbul/core', '@zipbul/common'];

    for (const peer of requiredFrameworkPeers) {
      const peerRange = peerDeps[peer];
      const directRange = directDeps[peer];

      if (peerRange === undefined && directRange === undefined) {
        errors.push(`package.json must declare \`${peer}\` in \`peerDependencies\` (preferred — shared with user app) or \`dependencies\`.`);
        continue;
      }

      const range = peerRange ?? directRange;
      if (typeof range !== 'string' || range.trim().length === 0) {
        errors.push(`package.json \`${peerRange !== undefined ? 'peerDependencies' : 'dependencies'}."${peer}"\` must declare a non-empty semver range. Got: ${JSON.stringify(range)}.`);
      }
    }
  }

  if (errors.length === 1) {
    throw diag('CONTRACT', { reason: errors[0]!, file: pkgPath });
  }
  if (errors.length > 1) {
    throw diag('CONTRACT', {
      reason: `${errors.length} package.json issues:\n${errors.map(e => `  - ${e}`).join('\n')}`,
      file: pkgPath,
    });
  }
}

function normalizeRelative(p: string): string {
  return p.startsWith('./') ? p.slice(2) : p;
}

function readExportsDefault(exportsField: unknown): string | null {
  if (typeof exportsField === 'string') return exportsField;
  if (exportsField === null || typeof exportsField !== 'object') return null;

  const dotEntry = (exportsField as Record<string, unknown>)['.'];
  if (typeof dotEntry === 'string') return dotEntry;
  if (dotEntry === null || typeof dotEntry !== 'object') return null;

  const cond = dotEntry as Record<string, unknown>;
  for (const key of ['import', 'default', 'require']) {
    const value = cond[key];
    if (typeof value === 'string') return value;
    if (value !== null && typeof value === 'object') {
      const nested = (value as Record<string, unknown>)['default'];
      if (typeof nested === 'string') return nested;
    }
  }

  return null;
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
    throw diag('CONTRACT', {
      reason: `No TypeScript source files found in ${packageRoot}/src/ or ${packageRoot}/index.ts.`,
      file: packageRoot,
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

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function pickEntrySourceFile(tree: SourceTree, packageRoot: string): SourceFile {
  const matches: SourceFile[] = [];

  for (const file of tree) {
    if (findDefineAdapterCall(file.symbols) !== null) {
      matches.push(file);
    }
  }

  if (matches.length === 0) {
    throw diag('MISSING_EXPORT', {
      reason: `No file under ${packageRoot}/src/ exports a \`defineAdapter()\` call. The adapter package must export the result of \`defineAdapter({...})\`.`,
      file: packageRoot,
    });
  }

  if (matches.length > 1) {
    // Item 27 — exactly one defineAdapter() named export per package.
    const list = matches.map(m => m.filePath).join(', ');
    throw diag('DUPLICATE', {
      reason: `Multiple \`defineAdapter()\` calls found in adapter package (${list}). Item 27 requires exactly one.`,
      file: packageRoot,
    });
  }

  return matches[0]!;
}

function extractAdapterDefinition(entry: SourceFile): ExtractedAdapterDefinition {
  const found = findDefineAdapterCall(entry.symbols);

  if (found === null) {
    throw diag('MISSING_EXPORT', {
      reason: `No \`defineAdapter()\` export found in ${entry.filePath}.`,
      file: entry.filePath,
    });
  }

  const { call: adapterCall, symbol } = found;

  // Item 79 — anchor downstream diagnostics at the defineAdapter() call site,
  // using gildash's pre-resolved span (line/column) on the variable symbol.
  const posCtx = { position: { line: symbol.span.start.line, column: symbol.span.start.column } };

  const adapterId = readIdentifierField(adapterCall, 'adapter');

  if (adapterId === null) {
    throw diag('CONTRACT', {
      reason: `defineAdapter() must receive a config object whose \`adapter\` field is a class identifier reference.`,
      file: entry.filePath,
      ...posCtx,
    });
  }

  const phaseEnum = readIdentifierField(adapterCall, 'phase');
  const stepEnum = readIdentifierField(adapterCall, 'step');
  const contextType = readIdentifierField(adapterCall, 'context');

  if (phaseEnum === null || stepEnum === null) {
    throw diag('CONTRACT', {
      reason: `defineAdapter() must declare \`phase\` and \`step\` fields as enum identifier references.`,
      file: entry.filePath,
      ...posCtx,
    });
  }

  if (contextType === null) {
    throw diag('CONTRACT', {
      reason: `defineAdapter() must declare \`context\` field as a Context class identifier reference.`,
      file: entry.filePath,
      ...posCtx,
    });
  }

  const pipeline = readPipelineField(adapterCall);

  if (pipeline === null) {
    throw diag('CONTRACT', {
      reason: `defineAdapter() must declare a non-empty \`pipeline\` array of qualified enum members (e.g. \`HttpPhase.OnRequest\`, \`HttpStep.ResolveRoute\`, \`CoreStep.Handler\`).`,
      file: entry.filePath,
      ...posCtx,
    });
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

/**
 * Validates Adapter / Context class exports (Item 37·38·39).
 *
 * - Item 37: Adapter class must be exported (so user app can `new` it).
 * - Item 38: Context class must be exported (declaration merging target).
 * - Item 39: A package may declare exactly one Adapter class. We approximate
 *   by counting class symbols whose name === adapterId across the tree —
 *   duplicates here would be re-declarations under the same name (fatal),
 *   not multiple distinct adapter classes (which is a different smell caught
 *   by `pickEntrySourceFile` finding only one defineAdapter call).
 */
function validateClassExports(tree: SourceTree, extracted: ExtractedAdapterDefinition, packageRoot: string): void {
  const { adapterId, contextType } = extracted;

  let adapterFound: { exported: boolean; count: number } = { exported: false, count: 0 };
  let contextFound: { exported: boolean } = { exported: false };

  for (const file of tree) {
    for (const symbol of file.symbols) {
      if (symbol.kind !== 'class') continue;

      if (symbol.name === adapterId) {
        adapterFound = { exported: adapterFound.exported || symbol.isExported, count: adapterFound.count + 1 };
      }

      if (symbol.name === contextType) {
        contextFound = { exported: contextFound.exported || symbol.isExported };
      }
    }
  }

  if (adapterFound.count === 0) {
    throw diag('MISSING_EXPORT', {
      reason: `Adapter class \`${adapterId}\` not declared anywhere under ${packageRoot}/src/.`,
      file: packageRoot,
    });
  }

  if (adapterFound.count > 1) {
    throw diag('DUPLICATE', {
      reason: `Adapter class \`${adapterId}\` declared ${adapterFound.count} times under ${packageRoot}/src/. Only one declaration is allowed (Item 39).`,
      file: packageRoot,
    });
  }

  if (!adapterFound.exported) {
    throw diag('MISSING_EXPORT', {
      reason: `Adapter class \`${adapterId}\` must be exported from the adapter package so user apps can instantiate it (Item 37).`,
      file: packageRoot,
    });
  }

  if (!contextFound.exported) {
    throw diag('MISSING_EXPORT', {
      reason: `Context class \`${contextType}\` must be exported from the adapter package so declaration-merging consumers can reference it (Item 38).`,
      file: packageRoot,
    });
  }
}

/**
 * Validates the pipeline against the imported phase/step enums (Item 31·32·34·35·42·43).
 *
 * - Every `pipeline[i].qualifier` must be the `phase`/`step` enum identifier
 *   passed to `defineAdapter()`, OR a known external consumer-rank qualifier
 *   (currently only `CoreStep`).
 * - For locally-resolvable enums (those declared inside the adapter package),
 *   each `pipeline[i].name` must be a member of that enum.
 * - Pipeline must contain exactly one `CoreStep.Handler` (the consumer rank).
 * - Phase / step enum members must be uniquely named (Item 42·43).
 *
 * `CoreStep` lives in `@zipbul/core` (external) — we trust its `Handler`
 * member exists and validate cardinality only.
 */
function validatePipeline(tree: SourceTree, extracted: ExtractedAdapterDefinition, entryFilePath: string): void {
  const { phaseEnum, stepEnum, pipeline } = extracted.pipelineSchema;

  const phaseMembers = resolveEnumMembers(tree, phaseEnum);
  const stepMembers = resolveEnumMembers(tree, stepEnum);

  let handlerCount = 0;

  for (let index = 0; index < pipeline.length; index += 1) {
    const ref = pipeline[index]!;

    if (ref.qualifier === 'CoreStep' && ref.name === 'Handler') {
      handlerCount += 1;
      continue;
    }

    if (ref.qualifier === phaseEnum) {
      if (phaseMembers !== null && !phaseMembers.has(ref.name)) {
        throw diag('CONTRACT', {
          reason: `pipeline[${index}] = \`${ref.qualifier}.${ref.name}\` — \`${ref.name}\` is not a member of \`${phaseEnum}\`. Members: [${[...phaseMembers].sort().join(', ')}].`,
          file: entryFilePath,
        });
      }
      continue;
    }

    if (ref.qualifier === stepEnum) {
      if (stepMembers !== null && !stepMembers.has(ref.name)) {
        throw diag('CONTRACT', {
          reason: `pipeline[${index}] = \`${ref.qualifier}.${ref.name}\` — \`${ref.name}\` is not a member of \`${stepEnum}\`. Members: [${[...stepMembers].sort().join(', ')}].`,
          file: entryFilePath,
        });
      }
      continue;
    }

    if (ref.qualifier === 'CoreStep') {
      // Other CoreStep members (Validation, Guard, ...) are accepted without
      // local resolution — `@zipbul/core` is external and trusted.
      continue;
    }

    throw diag('CONTRACT', {
      reason: `pipeline[${index}] = \`${ref.qualifier}.${ref.name}\` — qualifier \`${ref.qualifier}\` is not the configured \`phase\` (\`${phaseEnum}\`) or \`step\` (\`${stepEnum}\`) enum, nor \`CoreStep\`.`,
      file: entryFilePath,
    });
  }

  if (handlerCount !== 1) {
    throw diag('CONTRACT', {
      reason: `pipeline must contain exactly one consumer-rank step (\`CoreStep.Handler\`) — found ${handlerCount} (Item 32).`,
      file: entryFilePath,
    });
  }
}

/**
 * Resolves an enum's member name set from the source tree, returning `null`
 * when the enum is declared outside the package (external import — trusted).
 *
 * Supports both `enum Foo { A, B }` (gildash kind: 'enum') and
 * `const Foo = { A: 'A' } as const` (kind: 'variable' with object initializer).
 *
 * Detects duplicate member declarations (Item 42·43) at the raw-key level —
 * TS rejects duplicate `enum` members at compile time, but const-object
 * idioms can slip duplicates through. Throws DUPLICATE on collision.
 */
function resolveEnumMembers(tree: SourceTree, enumName: string): ReadonlySet<string> | null {
  for (const file of tree) {
    for (const symbol of file.symbols) {
      if (symbol.name !== enumName) continue;

      if (symbol.kind === 'enum') {
        const members = new Set<string>();
        const dupes = new Set<string>();
        for (const member of symbol.members ?? []) {
          if (typeof member.name === 'string' && member.name.length > 0) {
            if (members.has(member.name)) dupes.add(member.name);
            members.add(member.name);
          }
        }
        if (dupes.size > 0) {
          throw diag('DUPLICATE', {
            reason: `enum \`${enumName}\` has duplicate member name(s): [${[...dupes].join(', ')}] (Item 42·43).`,
            file: file.filePath,
          });
        }
        return members;
      }

      if (symbol.kind === 'variable' && symbol.initializer !== undefined && symbol.initializer.kind === 'object') {
        const members = new Set<string>();
        const dupes = new Set<string>();
        for (const prop of symbol.initializer.properties) {
          if (prop.kind === 'spread') continue;
          if (prop.key.kind === 'string') {
            if (members.has(prop.key.value)) dupes.add(prop.key.value);
            members.add(prop.key.value);
          }
        }
        if (dupes.size > 0) {
          throw diag('DUPLICATE', {
            reason: `const enum-object \`${enumName}\` has duplicate key(s): [${[...dupes].join(', ')}] (Item 42·43).`,
            file: file.filePath,
          });
        }
        return members;
      }
    }
  }

  return null;
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

      throw diag('CONTRACT', {
        reason: `\`${adapterId}.clusterStrategy\` in ${file.filePath} must be \`ClusterStrategy.Shared\` or \`ClusterStrategy.Exclusive\` (or the equivalent string literal).`,
        file: file.filePath,
      });
    }
  }

  throw diag('MISSING_EXPORT', {
    reason: `Adapter class \`${adapterId}\` not found while resolving clusterStrategy under ${packageRoot}/src/.`,
    file: packageRoot,
  });
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
      const namespaces: ContextNamespaceProperty[] = [];

      for (const member of symbol.members ?? []) {
        if (member.modifiers.includes('private') || member.modifiers.includes('protected')) continue;
        if (typeof member.name !== 'string' || member.name.length === 0) continue;

        if (member.kind === 'method' && member.methodKind === 'method') {
          const params = (member.parameters ?? []).map(p => ({
            name: p.name,
            type: p.type ?? null,
          }));
          methods.push({
            name: member.name,
            params,
            returnType: member.returnType ?? null,
          });
          continue;
        }

        // Item 16 — public properties become namespace entries. Middleware
        // augments later refine these (e.g. ctx.request.cookie); this
        // manifest only records the structural surface declared on the class.
        if (member.kind === 'property') {
          namespaces.push({
            name: member.name,
            type: member.returnType ?? null,
          });
        }
      }

      methods.sort((a, b) => a.name.localeCompare(b.name));
      namespaces.sort((a, b) => a.name.localeCompare(b.name));

      return {
        $schemaName: 'adapter.context-namespaces',
        contextType,
        methods,
        namespaces,
      };
    }
  }

  throw diag('MISSING_EXPORT', {
    reason: `Context class \`${contextType}\` not found anywhere under ${packageRoot}/src/.`,
    file: packageRoot,
  });
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
        throw diag('CONTRACT', {
          reason: `Adapter class \`${adapterId}\` (in ${file.filePath}) constructor must accept at most one options parameter (Item 44). Found ${params.length}.`,
          file: file.filePath,
        });
      }

      return {
        $schemaName: 'adapter.constructor-schema',
        optionsParam: { name: first.name, type: first.type ?? null },
        optional: first.isOptional === true,
      };
    }
  }

  throw diag('MISSING_EXPORT', {
    reason: `Adapter class \`${adapterId}\` not found while resolving constructor schema under ${packageRoot}/src/.`,
    file: packageRoot,
  });
}

/**
 * Adapter packages must be *pure protocol adapters* — they may not embed
 * `defineMiddleware()` / `defineGuard()` / `defineExceptionFilter()` calls.
 * Cross-cutting concerns (cookies / body parsing / compression / request id /
 * leader election etc.) belong in separate middleware library packages
 * compiled with `zb build --lib` and consumed via user-app module
 * registration. This validator scans the adapter source tree and raises
 * a CONTRACT diagnostic listing every offending export.
 */
function validateNoBuiltinMiddleware(tree: SourceTree, packageRoot: string): void {
  const FORBIDDEN = new Set(['defineMiddleware', 'defineGuard', 'defineExceptionFilter']);
  const offenders: Array<{ exportName: string; sourceFile: string; callee: string }> = [];

  for (const file of tree) {
    const sourceFile = relativeFromRoot(file.filePath, packageRoot);
    for (const symbol of file.symbols) {
      if (symbol.kind !== 'variable' || !symbol.isExported) continue;
      const init = symbol.initializer;
      if (init === undefined || init.kind !== 'call') continue;
      if (!FORBIDDEN.has(init.callee)) continue;
      offenders.push({ exportName: symbol.name, sourceFile, callee: init.callee });
    }
  }

  if (offenders.length === 0) return;

  const formatted = offenders
    .sort((a, b) => a.sourceFile.localeCompare(b.sourceFile) || a.exportName.localeCompare(b.exportName))
    .map(o => `  - ${o.sourceFile} :: ${o.exportName} = ${o.callee}(...)`)
    .join('\n');

  throw diag('CONTRACT', {
    reason: `Adapter packages must be pure protocol adapters and may not embed middleware/guards/exception-filters. Move the following exports to a separate library package (compile with \`zb build --lib\`):\n${formatted}`,
    file: packageRoot,
  });
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
        throw diag('CONTRACT', {
          reason: `Adapter class \`${adapterId}\` in ${file.filePath} must declare a \`decorators\` instance property of shape \`{ controller, handlers, options? }\`.`,
          file: file.filePath,
        });
      }

      return readAdapterEntryDecorators(decoratorsMember.initializer, file.filePath, adapterId);
    }
  }

  throw diag('MISSING_EXPORT', {
    reason: `Adapter class \`${adapterId}\` not found anywhere under ${packageRoot}/src/.`,
    file: packageRoot,
  });
}

function readAdapterEntryDecorators(
  init: ExpressionValue,
  filePath: string,
  adapterId: string,
): DecoratorSchema {
  if (init.kind !== 'object') {
    throw diag('CONTRACT', {
      reason: `Adapter class \`${adapterId}\` (in ${filePath}) decorators property must be an object literal.`,
      file: filePath,
    });
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
        throw diag('CONTRACT', {
          reason: `decorators.controller in ${filePath} must be a single identifier reference (Item 41 — exactly 1).`,
          file: filePath,
        });
      }
      controller = prop.value.name;
    } else if (fieldName === 'handlers') {
      handlers = readIdentifierArray(prop.value, 'decorators.handlers', filePath);

      if (handlers.length === 0) {
        throw diag('CONTRACT', {
          reason: `decorators.handlers in ${filePath} must contain at least one identifier reference (Item 41 — 1+).`,
          file: filePath,
        });
      }
    } else if (fieldName === 'options') {
      options = readIdentifierArray(prop.value, 'decorators.options', filePath);
    }
  }

  if (controller === null) {
    throw diag('CONTRACT', {
      reason: `decorators.controller missing in ${filePath} (Item 41).`,
      file: filePath,
    });
  }

  if (handlers === null) {
    throw diag('CONTRACT', {
      reason: `decorators.handlers missing in ${filePath} (Item 41).`,
      file: filePath,
    });
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
    throw diag('CONTRACT', {
      reason: `${label} in ${filePath} must be an array literal of identifier references.`,
      file: filePath,
    });
  }

  const out: string[] = [];

  for (const element of value.elements) {
    if (element.kind !== 'identifier') {
      throw diag('CONTRACT', {
        reason: `${label} in ${filePath} must contain only identifier references (no spreads, calls, or literals).`,
        file: filePath,
      });
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
    throw diag('DUPLICATE', {
      reason: `Duplicate decorator name(s) [${[...dupes].join(', ')}] in ${filePath} (Item 40).`,
      file: filePath,
    });
  }
}

function findDefineAdapterCall(symbols: readonly ExtractedSymbol[]): { call: ExpressionCall; symbol: ExtractedSymbol } | null {
  for (const symbol of symbols) {
    if (symbol.kind !== 'variable' || !symbol.isExported) continue;
    const init = symbol.initializer;

    if (init === undefined || init.kind !== 'call') continue;
    if (init.callee !== 'defineAdapter') continue;

    return { call: init, symbol };
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
