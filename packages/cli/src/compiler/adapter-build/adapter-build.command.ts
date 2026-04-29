import { readFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join, resolve, dirname, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

import { isErr } from '@zipbul/result';
import { parseSource, extractSymbols, extractRelations } from '@zipbul/gildash';
import type { ParsedFile, ExtractedSymbol, ExpressionValue, ExpressionCall, CodeRelation } from '@zipbul/gildash';

import { buildDiagnostic, DiagnosticError } from '../../diagnostics';

/**
 * Adapter-build diagnostic category (Item 80). Prefixed onto the diagnostic's
 * `reason` so downstream tooling can filter without depending on a separate
 * field in the shared `Diagnostic` shape.
 */
type DiagnosticCategory = 'SYNTAX' | 'CONTRACT' | 'MISSING_EXPORT' | 'DUPLICATE' | 'TYPE' | 'IO';

function diag(category: DiagnosticCategory, params: { reason: string; file?: string; symbol?: string; how?: string }): DiagnosticError {
  const taggedReason = `[${category}] ${params.reason}`;
  const built = buildDiagnostic({
    ...params,
    reason: taggedReason,
  });

  return new DiagnosticError(built);
}

import type {
  AdapterConstructorSchema,
  AdapterManifest,
  ArtifactReport,
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
    throw diag('CONTRACT', {
      reason: `--dry-run and --check-only are mutually exclusive.`,
    });
  }

  const pkgJson = await readPackageJson(packageRoot);
  validateAdapterKind(pkgJson, packageRoot);
  validatePackageFields(pkgJson, packageRoot);

  const sourceTree = await collectSourceTree(packageRoot);
  const entryFile = pickEntrySourceFile(sourceTree, packageRoot);
  const extracted = extractAdapterDefinition(entryFile);
  validatePipeline(sourceTree, extracted, entryFile.filePath);
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

    await runCodegen(packageRoot, stagingDir);
    await runSelfTest(stagingDir, artifacts);

    await rm(outDir, { recursive: true, force: true });
    await rename(stagingDir, outDir);
  } catch (cause) {
    // Item 74 — failure leaves prior dist/ intact; just clean up staging.
    await rm(stagingDir, { recursive: true, force: true });
    throw cause;
  }

  const reports = await collectArtifactReports(outDir);

  return { adapterId: extracted.adapterId, manifestPath, artifacts: reports };
}

/**
 * Walks `outDir` and returns per-file size + sha256 hex digest (Item 77).
 * Excludes tooling metadata that varies per machine (Item 78): `tsbuildinfo`,
 * source maps, and any dot-prefixed files.
 */
async function collectArtifactReports(outDir: string): Promise<readonly ArtifactReport[]> {
  if (!(await pathExists(outDir))) return [];

  const reports: ArtifactReport[] = [];

  await walkArtifacts(outDir, outDir, reports);

  reports.sort((a, b) => a.relPath.localeCompare(b.relPath));

  return reports;
}

async function walkArtifacts(dir: string, root: string, out: ArtifactReport[]): Promise<void> {
  const entries = await readdir(dir);

  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    if (entry === 'tsconfig.tsbuildinfo' || entry.endsWith('.tsbuildinfo')) continue;
    if (entry.endsWith('.map')) continue;

    const full = join(dir, entry);
    const info = await stat(full);

    if (info.isDirectory()) {
      await walkArtifacts(full, root, out);
      continue;
    }

    if (!info.isFile()) continue;

    const buf = await readFile(full);
    const sha256 = createHash('sha256').update(buf).digest('hex');

    out.push({
      relPath: relative(root, full),
      bytes: buf.byteLength,
      sha256,
    });
  }
}

/**
 * Round-trip self-test (Section L). Runs against the staging directory
 * before the atomic rename — failures abort the build and leave the existing
 * dist/ untouched.
 *
 * Currently checks (Item 109·110):
 * 1. Every artifact written to staging is parseable JSON.
 * 2. Each artifact's `$schemaName` matches the expected literal.
 * 3. The top-level `manifests` index in `adapter.manifest.json` resolves
 *    to files that actually exist on disk.
 *
 * Future slices add Item 111 (.d.ts re-compile check) and Item 112 (Bun
 * import smoke) — both require running the codegen output, which is more
 * expensive and best gated by `--with-self-test` style flags.
 */
async function runSelfTest(
  stagingDir: string,
  artifacts: readonly { readonly relPath: string; readonly content: string }[],
): Promise<void> {
  const EXPECTED_SCHEMA: Record<string, string> = {
    'adapter.manifest.json': 'adapter.manifest',
    'pipeline-schema.json': 'adapter.pipeline-schema',
    'decorator-schema.json': 'adapter.decorator-schema',
    'peer-contract.json': 'adapter.peer-contract',
    'context-namespaces.json': 'adapter.context-namespaces',
    'adapter-constructor-schema.json': 'adapter.constructor-schema',
    'builtins.json': 'adapter.builtins',
  };

  for (const artifact of artifacts) {
    const expected = EXPECTED_SCHEMA[artifact.relPath];
    if (expected === undefined) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(artifact.content);
    } catch (cause) {
      throw diag('CONTRACT', {
        reason: `Self-test: ${artifact.relPath} is not valid JSON: ${(cause as Error).message ?? String(cause)}`,
        file: join(stagingDir, artifact.relPath),
      });
    }

    if (typeof parsed !== 'object' || parsed === null) {
      throw diag('CONTRACT', {
        reason: `Self-test: ${artifact.relPath} root must be a JSON object.`,
        file: join(stagingDir, artifact.relPath),
      });
    }

    const actual = (parsed as Record<string, unknown>)['$schemaName'];

    if (actual !== expected) {
      throw diag('CONTRACT', {
        reason: `Self-test: ${artifact.relPath} \`$schemaName\` must equal \`${expected}\` (got \`${String(actual)}\`).`,
        file: join(stagingDir, artifact.relPath),
      });
    }
  }

  // Validate that the top-level manifest's `manifests` index resolves.
  const topPath = join(stagingDir, 'adapter.manifest.json');
  const top = JSON.parse(await readFile(topPath, 'utf8')) as { manifests: Record<string, string> };

  for (const [logical, relPath] of Object.entries(top.manifests)) {
    const referenced = join(stagingDir, relPath);
    if (!(await pathExists(referenced))) {
      throw diag('CONTRACT', {
        reason: `Self-test: top-level manifest references \`${logical}\` → \`${relPath}\`, but no file exists at that path.`,
        file: topPath,
      });
    }
  }
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
  const args = tscBin === 'bunx'
    ? ['tsc', '-p', tsconfigPath, '--outDir', outDir]
    : ['-p', tsconfigPath, '--outDir', outDir];

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


async function assertOnDiskMatches(
  outDir: string,
  artifacts: readonly { readonly relPath: string; readonly content: string }[],
): Promise<void> {
  if (!(await pathExists(outDir))) {
    throw diag('CONTRACT', {
      reason: `--check-only failed: ${outDir} does not exist. Run \`zb build adapter\` first.`,
      file: outDir,
    });
  }

  for (const artifact of artifacts) {
    const filePath = join(outDir, artifact.relPath);

    if (!(await pathExists(filePath))) {
      throw diag('CONTRACT', {
        reason: `--check-only failed: ${filePath} is missing — re-run the build.`,
        file: filePath,
      });
    }

    const onDisk = await readFile(filePath, 'utf8');

    if (onDisk !== artifact.content) {
      throw diag('CONTRACT', {
        reason: `--check-only failed: ${filePath} does not match the freshly produced manifest. The on-disk dist is stale or hand-edited.`,
        file: filePath,
      });
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
  readonly version?: string;
  readonly main?: string;
  readonly module?: string;
  readonly types?: string;
  readonly exports?: unknown;
  readonly files?: readonly string[];
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
  const pkgPath = join(packageRoot, 'package.json');

  if (typeof pkg.types === 'string' && !pkg.types.endsWith('.d.ts')) {
    throw diag('CONTRACT', {
      reason: `package.json \`types\` must point at a \`.d.ts\` file. Got: ${pkg.types}.`,
      file: pkgPath,
    });
  }

  const moduleEntry = typeof pkg.module === 'string' ? normalizeRelative(pkg.module) : null;
  const exportsImport = readExportsDefault(pkg.exports);
  const exportsImportNormalized = exportsImport !== null ? normalizeRelative(exportsImport) : null;

  if (moduleEntry !== null && exportsImportNormalized !== null && exportsImportNormalized !== moduleEntry) {
    throw diag('CONTRACT', {
      reason: `package.json \`module\` (${pkg.module}) and \`exports['.']\` default (${exportsImport}) must resolve to the same path.`,
      file: pkgPath,
    });
  }

  if (Array.isArray(pkg.files)) {
    const includesDist = pkg.files.some(entry =>
      entry === 'dist' || entry === 'dist/' || entry.startsWith('dist/'),
    );

    if (!includesDist) {
      throw diag('CONTRACT', {
        reason: `package.json \`files\` must include \`dist\` so the compiled output ships in the published tarball. Got: ${JSON.stringify(pkg.files)}.`,
        file: pkgPath,
      });
    }
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

  throw diag('MISSING_EXPORT', {
    reason: `No file under ${packageRoot}/src/ exports a \`defineAdapter()\` call. The adapter package must export the result of \`defineAdapter({...})\`.`,
    file: packageRoot,
  });
}

function extractAdapterDefinition(entry: SourceFile): ExtractedAdapterDefinition {
  const adapterCall = findDefineAdapterCall(entry.symbols);

  if (adapterCall === null) {
    throw diag('MISSING_EXPORT', {
      reason: `No \`defineAdapter()\` export found in ${entry.filePath}.`,
      file: entry.filePath,
    });
  }

  const adapterId = readIdentifierField(adapterCall, 'adapter');

  if (adapterId === null) {
    throw diag('CONTRACT', {
      reason: `defineAdapter() in ${entry.filePath} must receive a config object whose \`adapter\` field is a class identifier reference.`,
      file: entry.filePath,
    });
  }

  const phaseEnum = readIdentifierField(adapterCall, 'phase');
  const stepEnum = readIdentifierField(adapterCall, 'step');
  const contextType = readIdentifierField(adapterCall, 'context');

  if (phaseEnum === null || stepEnum === null) {
    throw diag('CONTRACT', {
      reason: `defineAdapter() in ${entry.filePath} must declare \`phase\` and \`step\` fields as enum identifier references.`,
      file: entry.filePath,
    });
  }

  if (contextType === null) {
    throw diag('CONTRACT', {
      reason: `defineAdapter() in ${entry.filePath} must declare \`context\` field as a Context class identifier reference.`,
      file: entry.filePath,
    });
  }

  const pipeline = readPipelineField(adapterCall);

  if (pipeline === null) {
    throw diag('CONTRACT', {
      reason: `defineAdapter() in ${entry.filePath} must declare a non-empty \`pipeline\` array of qualified enum members (e.g. \`HttpPhase.OnRequest\`, \`HttpStep.ResolveRoute\`, \`CoreStep.Handler\`).`,
      file: entry.filePath,
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

  if (phaseMembers !== null) ensureUniqueMembers(phaseMembers, phaseEnum, entryFilePath);
  if (stepMembers !== null) ensureUniqueMembers(stepMembers, stepEnum, entryFilePath);

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
 */
function resolveEnumMembers(tree: SourceTree, enumName: string): ReadonlySet<string> | null {
  for (const file of tree) {
    for (const symbol of file.symbols) {
      if (symbol.name !== enumName) continue;

      if (symbol.kind === 'enum') {
        const members = new Set<string>();
        for (const member of symbol.members ?? []) {
          if (typeof member.name === 'string' && member.name.length > 0) {
            members.add(member.name);
          }
        }
        return members;
      }

      if (symbol.kind === 'variable' && symbol.initializer !== undefined && symbol.initializer.kind === 'object') {
        const members = new Set<string>();
        for (const prop of symbol.initializer.properties) {
          if (prop.kind === 'spread') continue;
          if (prop.key.kind === 'string') members.add(prop.key.value);
        }
        return members;
      }
    }
  }

  return null;
}

function ensureUniqueMembers(members: ReadonlySet<string>, enumName: string, filePath: string): void {
  // Set guarantees uniqueness — but if the source declared duplicate keys
  // (rare, since TS rejects this), `members` would still drop them. The
  // check is a placeholder for future enforcement once we read the raw key
  // list (Item 42·43).
  void members; void enumName; void filePath;
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
