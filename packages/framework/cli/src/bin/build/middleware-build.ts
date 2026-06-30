import { readdir, readFile, writeFile } from 'fs/promises';
import { Glob } from 'bun';
import { dirname, join, resolve, relative } from 'path';

import type { BuildCommandDeps } from './interfaces';

/**
 * The dependencies `zb build middleware` actually uses — a narrow slice of
 * {@link BuildCommandDeps} so callers and tests wire exactly what runs.
 */
export type MiddlewareBuildDeps = Pick<BuildCommandDeps, 'scanFiles'>;

import { extractSymbols, parseSource, is } from '@zipbul/gildash';
import type { Node as AstNode } from '@zipbul/gildash';
import { isErr } from '@zipbul/result';
import { Logger } from '@zipbul/logger';
import { validateDefineCallShape } from '../../compiler/define-call-shape';
import { withAtomicEmit, runTsgo, type CancellationScope } from '../../common';
import { buildDiagnostic, DiagnosticError } from '../../diagnostics';
import {
  extractMiddlewareAugmentEntries,
  type MiddlewareAugmentEntry,
} from '../../compiler/generator/middleware-augment-injector';
import { extractMiddlewareAugments } from '../../compiler/analyzer/parser/middleware-augment-extractor';
import type { MiddlewareContextAugment } from '../../compiler/analyzer/adapter/middleware-context-types';
import { ContextTypesGenerator, type AugmentTargetEntry, type AugmentTargetMap } from '../../compiler/generator/context-types-generator';
import { ImportRegistry } from '../../compiler/generator/import-registry';

/**
 * Per-file augment extraction result for reporting.
 */
interface FileAugmentReport {
  readonly file: string;
  readonly middlewares: readonly MiddlewareReport[];
  readonly skipped: readonly SkippedMiddlewareReport[];
}

interface MiddlewareReport {
  readonly name: string;
  readonly contextType: string | null;
  readonly augmentCount: number;
}

interface SkippedMiddlewareReport {
  readonly name: string;
  readonly reason: string;
}

/**
 * Resolved middleware-library build configuration from package.json.
 *
 * The build source set is `entryFile + srcDir/**` — the exact set
 * `tsconfig.build.json` compiles (`include: ["index.ts", "src/**"]`), so the
 * JS bundle and the `.d.ts` emit always describe the same package surface.
 */
interface MiddlewareBuildConfig {
  readonly packageName: string;
  /** Package entry (projectRoot-relative, e.g. `index.ts`) — the file package.json `exports`/`module` is built from. */
  readonly entryFile: string;
  readonly srcDir: string;
  readonly outDir: string;
  readonly projectRoot: string;
}

const log = new Logger('build/middleware');

/**
 * Internal runner for `zb build middleware`. The public entry
 * (`buildMiddleware()` in `./middleware-entry.ts`) wires production deps
 * and a cancellation scope, then delegates here.
 *
 * Scans TypeScript source files for `defineMiddleware()` calls,
 * extracts augment metadata from factory bodies, injects `__augments`
 * fields into the compiled JS output, and emits `dist/context-augments.d.ts`
 * so consumers of the published npm package gain typed context
 * augmentation without modifying their own tsconfig.
 *
 * @public
 */
export async function runMiddlewareBuild(
  deps: MiddlewareBuildDeps,
  cancel?: CancellationScope,
): Promise<void> {
  const projectRoot = process.cwd();

  // ── 1. Read package.json ────────────────────────────────────
  const config = await resolveMiddlewareBuildConfig(projectRoot);

  log.info('package=%s entry=%s source=%s output=%s',
    config.packageName,
    config.entryFile,
    relative(projectRoot, config.srcDir) || '.',
    relative(projectRoot, config.outDir) || '.');

  // ── 2. Scan source files ────────────────────────────────────
  // The source set is entryFile + srcDir/** — exactly what tsconfig.build.json
  // compiles — so the JS bundle and `.d.ts` emit cover the same files. All
  // paths are projectRoot-relative from here on.
  log.time('scan');

  const glob = new Glob('**/*.ts');
  const srcDirRelative = relative(projectRoot, config.srcDir);
  const allFiles = await deps.scanFiles({ glob, baseDir: config.srcDir });
  const sourceFiles = [
    config.entryFile,
    ...allFiles
      .filter(f => !f.endsWith('.d.ts') && !f.endsWith('.spec.ts') && !f.endsWith('.test.ts'))
      .map(f => join(srcDirRelative, f)),
  ].filter((file, index, files) => files.indexOf(file) === index);

  log.info('scanned %d source files', sourceFiles.length);
  log.timeEnd('scan');

  // Validate that every `defineX` call in the package follows the
  // `export const X = defineX(...)` shape — single normative rule, no other
  // call site is allowed. Runs before augment extraction so the extractor can
  // assume the well-formed shape.
  const shapeInputs = await Promise.all(sourceFiles.map(async file => {
    const fullPath = join(projectRoot, file);
    const sourceText = await Bun.file(fullPath).text();
    const parsed = parseSource(fullPath, sourceText);
    if (isErr(parsed)) {
      throw new DiagnosticError(buildDiagnostic({
        reason: `Failed to parse ${fullPath} for shape validation: ${JSON.stringify(parsed.data)}`,
        file: fullPath,
        how: 'Fix the TypeScript syntax error reported above. Run `bunx tsc --noEmit` for the full type-checker output.',
      }));
    }
    return { filePath: file, parsed };
  }));
  validateDefineCallShape(shapeInputs);

  // ── 3. Extract augments (for context-augments.d.ts emission) ─
  // The augment metadata drives the consumer-facing `context-augments.d.ts`
  // (declaration merging) emitted below. The runtime assignment itself lives
  // in the middleware factory source as-is; nothing is injected into the JS.
  log.time('extract');

  const reports: FileAugmentReport[] = [];
  let totalAugments = 0;
  let totalSkipped = 0;

  for (const file of sourceFiles) {
    const fullPath = join(projectRoot, file);
    const sourceText = await Bun.file(fullPath).text();
    const { entries, skipped } = extractAndDetectSkipped(fullPath, sourceText);

    if (entries.length > 0 || skipped.length > 0) {
      reports.push({
        file,
        middlewares: entries.map(e => ({
          name: e.name,
          contextType: e.contextType,
          augmentCount: e.augments.length,
        })),
        skipped,
      });
    }

    totalAugments += entries.length;
    totalSkipped += skipped.length;
  }

  log.info('extracted augments from %d middleware export(s)', totalAugments);
  log.timeEnd('extract');

  // Report skipped middlewares
  for (const report of reports) {
    for (const skip of report.skipped) {
      log.warn('%s: %s — %s', report.file, skip.name, skip.reason);
    }
  }

  if (totalAugments === 0 && totalSkipped === 0) {
    log.warn('no defineMiddleware() exports with context augments found; if this is a middleware library, verify your factory uses ctx.to() and assigns to context properties');
  }

  // ── 3·5. Pre-tsc: emit context-augments.d.ts inside `srcDir` so tsc picks
  // it up via the existing include scope. Without this, the middleware's
  // own runtime assignment (`http.request.cookie = new CookieJar(...)`)
  // fails type-checking because tsc sees the unaugmented `HttpRequest`.
  // The file is moved to the staging dir after tsc and removed from src.
  const augmentsInSrc = totalAugments > 0
    ? await prepareContextAugmentsForTsc({
      projectRoot,
      sourceFiles,
      srcDir: config.srcDir,
      cancel,
    })
    : null;

  // ── 4. Atomic emit: tsgo (JS + .d.ts) → staging → swap ──
  // tsgo compiles JS and `.d.ts` in one type-checked per-file pass (no bundle),
  // driven by the package's `tsconfig.build.json`. Unbundled per-file output
  // avoids Bun's bundler corrupting `export *` re-export barrels and loads in
  // Bun at runtime as-is. The augment `.d.ts` pre-emitted into `srcDir` above
  // makes the middleware's own context assignments (`http.request.cookie = …`)
  // type-check; it is moved to `dist/context-augments.d.ts` afterward.
  log.time('compile');

  const tsconfigBuildPath = join(projectRoot, 'tsconfig.build.json');

  if (!(await Bun.file(tsconfigBuildPath).exists())) {
    throw new DiagnosticError(buildDiagnostic({
      reason: 'Middleware build requires a `tsconfig.build.json` at the package root.',
      file: tsconfigBuildPath,
      how: 'Add a `tsconfig.build.json` extending the repo-root build config (see `packages/middlewares/query-parser/tsconfig.build.json`).',
    }));
  }

  await withAtomicEmit(
    {
      finalDir: config.outDir,
      stagingDir: `${config.outDir}.staging`,
      ...(cancel !== undefined ? { registerCleanup: cancel.registerCleanup } : {}),
    },
    async (stagingDir) => {
      try {
        await runTsgo(projectRoot, tsconfigBuildPath, stagingDir, cancel?.signal);
      } catch (error) {
        throw new DiagnosticError(buildDiagnostic({
          reason: error instanceof Error ? error.message : String(error),
          how: 'Run `bunx tsgo -p tsconfig.build.json` directly to see the full type errors and fix them, then retry `zb build middleware`.',
        }));
      }

      log.info('compiled JS + type declarations (tsgo)');
      log.timeEnd('compile');

      // ── Context augmentation .d.ts (declaration merging) ──
      // Move the pre-emitted augments file from `srcDir` to staging as
      // `context-augments.d.ts` and prepend `/// <reference path>` to every
      // `.d.ts` file tsgo just emitted. Consumers importing the middleware
      // pick up the augmentation automatically — no consumer tsconfig
      // modification.
      if (augmentsInSrc !== null) {
        await finalizeContextAugmentsDts({
          stagingDir,
          augmentsInSrcPath: augmentsInSrc.path,
        });
      }
    },
  );

  if (augmentsInSrc !== null) {
    // Cleanup: remove src copy whether or not staging promotion succeeded.
    // (When promotion succeeds, finalize already removed it; this is a
    // best-effort safety net for the failure path.)
    await augmentsInSrc.cleanup();
  }

  // ── Summary ────────────────────────────────────────────────
  for (const report of reports) {
    for (const mw of report.middlewares) {
      log.info('augment %s contextType=%s augments=%d',
        mw.name, mw.contextType ?? '(none)', mw.augmentCount);
    }
  }
}

/**
 * Reads package.json and resolves library build configuration.
 * No zipbul.json required — library builds use package.json only.
 */
async function resolveMiddlewareBuildConfig(projectRoot: string): Promise<MiddlewareBuildConfig> {
  const packageJsonPath = join(projectRoot, 'package.json');
  const packageJsonFile = Bun.file(packageJsonPath);

  if (!(await packageJsonFile.exists())) {
    throw new DiagnosticError(buildDiagnostic({
      reason: 'package.json not found.',
      file: packageJsonPath,
      how: 'Run `zb build middleware` from the directory containing the package\'s `package.json`.',
    }));
  }

  let parsed: unknown;

  try {
    parsed = await packageJsonFile.json();
  } catch {
    throw new DiagnosticError(buildDiagnostic({
      reason: 'Failed to parse package.json.',
      file: packageJsonPath,
      how: 'Validate the file with `bun -e "console.log(await Bun.file(\'package.json\').json())"` or any JSON linter and fix the syntax error reported.',
    }));
  }

  if (!isJsonObject(parsed)) {
    throw new DiagnosticError(buildDiagnostic({
      reason: 'package.json must contain a JSON object at the top level.',
      file: packageJsonPath,
      how: 'Replace the top-level value with a `{ ... }` object containing at minimum "name" and "zipbul.kind" fields.',
    }));
  }

  const packageJson = parsed;

  const packageName = packageJson.name;

  if (typeof packageName !== 'string' || packageName.length === 0) {
    throw new DiagnosticError(buildDiagnostic({
      reason: 'package.json must have a "name" field.',
      file: packageJsonPath,
      how: 'Add a non-empty `"name"` string (e.g. `"@scope/middleware-name"`) to package.json.',
    }));
  }

  validateMiddlewareKind(packageJson, packageJsonPath);

  // Resolve source directory: package.json "source" field > "src/" > root
  const srcDir = await resolveSourceDir(projectRoot, packageJson);
  const entryFile = await resolveEntryFile(projectRoot, packageJson, srcDir);
  const outDir = resolve(projectRoot, 'dist');

  return { packageName, entryFile, srcDir, outDir, projectRoot };
}

/**
 * Narrows a parsed JSON value to a plain object record.
 */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Resolves the package entry file (projectRoot-relative) — the source that
 * package.json `exports`/`module` is built from, and the single Bun.build
 * entrypoint.
 *
 * Priority:
 * 1. `package.json#source` field (explicit entry file)
 * 2. `index.ts` at the package root (convention; all zipbul middleware packages)
 * 3. `index.ts` inside the source directory
 */
async function resolveEntryFile(
  projectRoot: string,
  packageJson: Record<string, unknown>,
  srcDir: string,
): Promise<string> {
  const sourceField = packageJson.source;

  if (typeof sourceField === 'string') {
    // Existence is already validated by resolveSourceDir.
    return relative(projectRoot, resolve(projectRoot, sourceField));
  }

  const rootEntry = 'index.ts';

  if (await Bun.file(join(projectRoot, rootEntry)).exists()) {
    return rootEntry;
  }

  const srcEntry = relative(projectRoot, join(srcDir, 'index.ts'));

  if (await Bun.file(join(projectRoot, srcEntry)).exists()) {
    return srcEntry;
  }

  throw new DiagnosticError(buildDiagnostic({
    reason: 'Cannot determine the package entry file.',
    how: 'Add an `index.ts` at the package root (or inside the source directory), or set `package.json#source` to the entry file path. The entry is what `exports`/`module` (`dist/index.js`) is built from.',
  }));
}

/**
 * `zb build middleware` only operates on packages that explicitly declare
 * `zipbul.kind === 'middleware'`. This makes the two compilers mutually
 * exclusive: an adapter package (`kind === 'adapter'`) cannot be compiled as
 * a middleware library, and vice-versa.
 */
function validateMiddlewareKind(packageJson: Record<string, unknown>, packageJsonPath: string): void {
  const zipbul = packageJson.zipbul;
  const kind = isJsonObject(zipbul) ? zipbul.kind : undefined;

  if (kind === 'middleware') return;

  throw new DiagnosticError(buildDiagnostic({
    reason: `\`zb build middleware\` only compiles middleware library packages. ${packageJsonPath} must declare \`"zipbul": { "kind": "middleware" }\`. Found: ${JSON.stringify(zipbul ?? null)}.`,
    file: packageJsonPath,
    how: 'For an adapter package use `zb build adapter` instead. For a middleware library, add `"zipbul": { "kind": "middleware" }` to package.json.',
  }));
}

/**
 * Detects the source directory from package.json or filesystem conventions.
 *
 * Priority:
 * 1. `package.json#source` field (explicit)
 * 2. `src/` directory (convention)
 * 3. `lib/` directory (convention)
 * 4. Build error with guidance
 */
async function resolveSourceDir(
  projectRoot: string,
  packageJson: Record<string, unknown>,
): Promise<string> {
  // Explicit source field
  const sourceField = packageJson.source;

  if (typeof sourceField === 'string') {
    const dir = dirname(resolve(projectRoot, sourceField));
    const exists = await Bun.file(resolve(projectRoot, sourceField)).exists();

    if (exists) return dir;

    throw new DiagnosticError(buildDiagnostic({
      reason: `package.json "source" field points to "${sourceField}" which does not exist.`,
      how: 'Update the "source" field to a real entry file path (relative to the package root) or remove it to fall back to `src/`.',
    }));
  }

  // Convention: src/
  const srcDir = join(projectRoot, 'src');

  if (await dirExists(srcDir)) return srcDir;

  // Convention: lib/
  const libDir = join(projectRoot, 'lib');

  if (await dirExists(libDir)) return libDir;

  throw new DiagnosticError(buildDiagnostic({
    reason: 'Cannot determine source directory.',
    how: 'Add a `"source"` field to package.json (e.g. `"source": "src/index.ts"`), or create a `src/` (or `lib/`) directory at the package root.',
  }));
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const { stat } = await import('fs/promises');
    const stats = await stat(path);

    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Extracts augments and detects skipped middlewares in a single parse pass.
 *
 * Uses `extractMiddlewareAugmentEntries` for augment extraction, then scans the same
 * parsed AST for `defineMiddleware` calls that produced no augments.
 */
function extractAndDetectSkipped(
  filePath: string,
  sourceText: string,
): { entries: MiddlewareAugmentEntry[]; skipped: SkippedMiddlewareReport[] } {
  const entries = extractMiddlewareAugmentEntries(filePath, sourceText);
  const successNames = new Set(entries.map(e => e.name));
  const skipped: SkippedMiddlewareReport[] = [];

  // Re-use the already-parsed AST via parseSource (extractMiddlewareAugmentEntries already parsed it;
  // parseSource caches by content, and this second call is essentially free for same input)
  const parseResult = parseSource(filePath, sourceText);

  if (isErr(parseResult)) return { entries, skipped };

  const symbols = extractSymbols(parseResult);

  for (const symbol of symbols) {
    if (symbol.kind !== 'variable') continue;
    if (symbol.initializer === undefined || symbol.initializer.kind !== 'call') continue;
    if (symbol.initializer.callee !== 'defineMiddleware') continue;
    if (successNames.has(symbol.name)) continue;

    skipped.push({
      name: symbol.name,
      reason: 'No context augments detected. Ensure the factory uses ctx.to(<ContextType>) and assigns properties like http.request.<prop> = new <Class>(...).',
    });
  }

  return { entries, skipped };
}

/**
 * Collects locally declared class names from a file's top-level statements
 * (handles both `class Foo {}` and `export class Foo {}`). Used so that
 * `new Foo(...)` augments where `Foo` is defined in the same file resolve
 * to a sibling-file import in the emitted `dist/context-augments.d.ts`.
 */
function collectLocalClassDeclarations(programBody: readonly AstNode[]): Set<string> {
  const names = new Set<string>();
  for (const stmt of programBody) {
    if (is.ClassDeclaration(stmt)) {
      if (stmt.id && is.Identifier(stmt.id)) names.add(stmt.id.name);
      continue;
    }
    if (is.ExportNamedDeclaration(stmt)) {
      const decl = stmt.declaration;
      if (decl && is.ClassDeclaration(decl) && decl.id && is.Identifier(decl.id)) {
        names.add(decl.id.name);
      }
    }
  }
  return names;
}

/**
 * Builds an import map from a parsed file's import declarations:
 * `localBindingName → moduleSpecifier`. Skips type-only imports.
 */
function buildSourceImportMap(programBody: readonly AstNode[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const stmt of programBody) {
    if (!is.ImportDeclaration(stmt)) continue;
    const source = stmt.source.value;
    if (typeof source !== 'string') continue;
    if (stmt.specifiers === undefined) continue;
    for (const spec of stmt.specifiers) {
      if (is.ImportSpecifier(spec) && is.Identifier(spec.local)) {
        map.set(spec.local.name, source);
      } else if (is.ImportDefaultSpecifier(spec) && is.Identifier(spec.local)) {
        map.set(spec.local.name, source);
      } else if (is.ImportNamespaceSpecifier(spec) && is.Identifier(spec.local)) {
        map.set(spec.local.name, source);
      }
    }
  }
  return map;
}

/**
 * Finds the named export's defineMiddleware factory function node.
 */
function findFactoryByName(programBody: readonly AstNode[], name: string): AstNode | null {
  for (const stmt of programBody) {
    let varDecl: AstNode | null = null;
    if (is.ExportNamedDeclaration(stmt) && stmt.declaration && is.VariableDeclaration(stmt.declaration)) {
      varDecl = stmt.declaration;
    } else if (is.VariableDeclaration(stmt)) {
      varDecl = stmt;
    }
    if (varDecl === null || !is.VariableDeclaration(varDecl)) continue;
    for (const decl of varDecl.declarations) {
      if (!is.Identifier(decl.id) || decl.id.name !== name) continue;
      if (decl.init === null || decl.init === undefined || !is.CallExpression(decl.init)) continue;
      const args = decl.init.arguments;
      if (args.length === 0) continue;
      const first = args[0]!;
      if (is.ArrowFunctionExpression(first) || is.FunctionExpression(first)) return first;
      if (args.length >= 2) {
        const second = args[1]!;
        if (is.ArrowFunctionExpression(second) || is.FunctionExpression(second)) return second;
      }
      if (is.ObjectExpression(first)) {
        for (const prop of first.properties) {
          if (!is.Property(prop) || !is.Identifier(prop.key) || prop.key.name !== 'factory') continue;
          if (is.ArrowFunctionExpression(prop.value) || is.FunctionExpression(prop.value)) return prop.value;
        }
      }
    }
  }
  return null;
}

/**
 * Reads the adapter's `dist/context-namespaces.json` from `node_modules` to
 * map `path[0]` segments (e.g. `'request'`) to TypeScript interface names
 * (e.g. `'HttpRequest'`).
 */
async function loadAdapterNamespaces(
  projectRoot: string,
  packageSpecifier: string,
): Promise<{ contextType: string; namespaces: Readonly<Record<string, string>> } | null> {
  const candidatePaths = [
    join(projectRoot, 'node_modules', packageSpecifier, 'dist', 'context-namespaces.json'),
  ];
  for (const candidate of candidatePaths) {
    const file = Bun.file(candidate);
    if (!(await file.exists())) continue;
    try {
      const json: unknown = await file.json();
      if (!isJsonObject(json) || typeof json.contextType !== 'string') continue;
      const namespaceMap: Record<string, string> = {};
      if (Array.isArray(json.namespaces)) {
        for (const entry of json.namespaces) {
          if (isJsonObject(entry) && typeof entry.name === 'string' && typeof entry.type === 'string') {
            namespaceMap[entry.name] = entry.type;
          }
        }
      }
      return { contextType: json.contextType, namespaces: namespaceMap };
    } catch {
      continue;
    }
  }
  return null;
}

/** File name for the in-src augment placeholder. Avoid colliding with
 *  user-authored files by using a deeply-prefixed name. */
const ZIPBUL_AUGMENTS_FILE = '__zipbul_context_augments__.d.ts';

/**
 * Builds `context-augments.d.ts` content from this package's middleware
 * augments and writes it to `<srcDir>/__zipbul_context_augments__.d.ts` so
 * tsc sees the `declare module` declarations during compilation. Returns a
 * handle with `path` (where it was written) and `cleanup` (idempotent
 * removal). Returns `null` when there are no augments to emit.
 */
async function prepareContextAugmentsForTsc(params: {
  projectRoot: string;
  sourceFiles: readonly string[];
  srcDir: string;
  cancel: CancellationScope | undefined;
}): Promise<{ path: string; cleanup: () => Promise<void> } | null> {
  const { projectRoot, sourceFiles, srcDir, cancel } = params;
  const dtsContent = await buildContextAugmentsDtsContent({ projectRoot, sourceFiles });
  if (dtsContent === null) return null;

  const augmentsPath = join(srcDir, ZIPBUL_AUGMENTS_FILE);
  await writeFile(augmentsPath, dtsContent, 'utf-8');

  let removed = false;
  const cleanup = async (): Promise<void> => {
    if (removed) return;
    removed = true;
    const { rm } = await import('fs/promises');
    await rm(augmentsPath, { force: true }).catch(() => {});
  };

  // SIGINT/SIGTERM cleanup — leaving the file inside src/ on cancel would
  // poison the next build (tsc + extractMiddlewareAugmentEntries would re-pick it up).
  if (cancel !== undefined) {
    cancel.registerCleanup(cleanup);
  }

  return { path: augmentsPath, cleanup };
}

/**
 * Moves the pre-emitted augments file from `srcDir` to `<stagingDir>/context-augments.d.ts`,
 * removes the src copy, and prepends `/// <reference path>` to every
 * tsc-emitted `.d.ts` file in staging.
 */
async function finalizeContextAugmentsDts(params: {
  stagingDir: string;
  augmentsInSrcPath: string;
}): Promise<void> {
  const { stagingDir, augmentsInSrcPath } = params;
  const stagingAugmentsPath = join(stagingDir, 'context-augments.d.ts');
  const dtsContent = await readFile(augmentsInSrcPath, 'utf-8');
  await writeFile(stagingAugmentsPath, dtsContent, 'utf-8');

  // tsc may have copied the augments .d.ts into staging under its src-relative
  // path (e.g. `dist/__zipbul_context_augments__.d.ts`). Remove that — the
  // canonical augment file is `dist/context-augments.d.ts`.
  await prependReferenceToAllDts(stagingDir);

  const { rm } = await import('fs/promises');
  await rm(augmentsInSrcPath, { force: true }).catch(() => {});
  // Remove any stray copy tsc emitted inside staging.
  await rm(join(stagingDir, ZIPBUL_AUGMENTS_FILE), { force: true }).catch(() => {});
}

/**
 * Constructs the `context-augments.d.ts` source string by extracting augments
 * from each source file and resolving the target adapter's namespace map from
 * the published manifest in node_modules. Returns `null` when there is nothing
 * to emit (no augments OR adapter manifest unresolvable for every contextType).
 */
async function buildContextAugmentsDtsContent(params: {
  projectRoot: string;
  sourceFiles: readonly string[];
}): Promise<string | null> {
  const { projectRoot, sourceFiles } = params;

  const allAugments: MiddlewareContextAugment[] = [];
  const adapterMap: Record<string, AugmentTargetMap> = {};
  const unresolvedAdapters = new Set<string>();

  for (const file of sourceFiles) {
    const fullPath = join(projectRoot, file);
    const sourceText = await readFile(fullPath, 'utf-8');
    const parseResult = parseSource(fullPath, sourceText);
    if (isErr(parseResult)) continue;
    const importMap = buildSourceImportMap(parseResult.program.body);
    const localClasses = collectLocalClassDeclarations(parseResult.program.body);

    const entries = extractMiddlewareAugmentEntries(fullPath, sourceText);
    for (const entry of entries) {
      if (entry.contextType === null || entry.augments.length === 0) continue;

      const factory = findFactoryByName(parseResult.program.body, entry.name);
      if (factory === null) continue;
      const augResult = extractMiddlewareAugments(factory);
      if (augResult === null || augResult.augments.length === 0) continue;

      const contextModule = importMap.get(entry.contextType);
      if (contextModule === undefined) continue;

      // Resolve the adapter's contextNamespaces (interface mapping)
      // once per (contextType, contextModule) pair.
      if (adapterMap[entry.contextType] === undefined) {
        const ns = await loadAdapterNamespaces(projectRoot, contextModule);
        if (ns === null) {
          unresolvedAdapters.add(contextModule);
          continue;
        }
        const targets: Record<string, AugmentTargetEntry> = {};
        for (const [getter, ifaceName] of Object.entries(ns.namespaces)) {
          targets[getter] = { interface: ifaceName, module: contextModule };
        }
        adapterMap[entry.contextType] = targets;
      }

      // Resolve `new X(...)` augment classes:
      // 1. imported from another module → use the import specifier
      // 2. declared in the same .ts file → reference via `./<file>` so the
      //    emitted `dist/context-augments.d.ts` can `import type` from the
      //    sibling `.d.ts` tsc emits for that same file.
      const classImports = new Map<string, string>();
      const registerType = (identifier: string): void => {
        if (classImports.has(identifier)) return;
        const importPath = importMap.get(identifier);
        if (importPath !== undefined) {
          classImports.set(identifier, importPath);
        } else if (localClasses.has(identifier)) {
          classImports.set(identifier, fullPath);
        }
      };
      for (const aug of augResult.augments) {
        if (aug.rhs.kind === 'class') {
          registerType(aug.rhs.identifier);
        } else if (aug.rhs.kind === 'method') {
          // Types referenced in a method-signature augment (type-param
          // constraints, param types, return type) may be imported — e.g.
          // `Class<T>` from `@zipbul/common`. Collect their imports so the
          // emitted augments file imports them; that also turns the file into
          // a module, so its `declare module` *augments* the target interface
          // instead of replacing the whole module (ambient declaration).
          const typeText = [
            ...aug.rhs.typeParams,
            ...aug.rhs.params.map(p => p.type ?? ''),
            aug.rhs.returnType ?? '',
          ].join(' ');
          for (const identifier of typeText.match(/[A-Za-z_$][\w$]*/g) ?? []) {
            registerType(identifier);
          }
        }
      }

      allAugments.push({
        middlewareName: entry.name,
        contextType: entry.contextType,
        sourceFilePath: fullPath,
        augments: augResult.augments,
        classImports,
      });
    }
  }

  for (const pkg of unresolvedAdapters) {
    log.warn(
      'adapter manifest not found for "%s" — augments targeting its context will not be emitted. Install the adapter package or upgrade it to a version that ships dist/context-namespaces.json.',
      pkg,
    );
  }

  if (allAugments.length === 0 || Object.keys(adapterMap).length === 0) {
    return null;
  }

  const generator = new ContextTypesGenerator();
  // Registry's outputDir is just used to compute relative paths for class
  // imports inside the augmentation. The class import paths are external
  // module specifiers (e.g. './cookie-jar' relative to src/index.ts), so the
  // exact outputDir value here does not affect the final import statements
  // emitted by `getImportStatements()` — they pass through as-is.
  const registry = new ImportRegistry(projectRoot);
  return generator.generate(allAugments, registry, adapterMap);
}

/**
 * Prepends `/// <reference path="./context-augments.d.ts" />` (with a relative
 * path) to every `.d.ts` file under `stagingDir` except `context-augments.d.ts`
 * itself. Idempotent — detects any prior triple-slash reference targeting
 * `context-augments.d.ts` (regardless of how the relative path was spelled)
 * via regex match anywhere in the file, so re-running the middleware build never
 * stacks duplicate directives. Per-file relative paths are recomputed because
 * nested .d.ts files at deeper subdirectories need different `../` prefixes.
 */
async function prependReferenceToAllDts(stagingDir: string): Promise<void> {
  const augmentFileName = 'context-augments.d.ts';
  // Matches `/// <reference path="...context-augments.d.ts" />` with any
  // relative-path spelling (`./`, `../../`) and any whitespace shape.
  const existingRefRegex = /\/\/\/\s*<\s*reference\s+path\s*=\s*["'][^"']*context-augments\.d\.ts["']\s*\/\s*>/;

  async function walk(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const out: string[] = [];
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...await walk(full));
      } else if (entry.isFile() && entry.name.endsWith('.d.ts') && entry.name !== augmentFileName) {
        out.push(full);
      }
    }
    return out;
  }

  const dtsFiles = await walk(stagingDir);
  for (const dts of dtsFiles) {
    const content = await readFile(dts, 'utf-8');
    if (existingRefRegex.test(content)) continue;

    const augmentsAbs = join(stagingDir, augmentFileName);
    const relPath = relative(dirname(dts), augmentsAbs).split('\\').join('/');
    const normalized = relPath.startsWith('.') ? relPath : `./${relPath}`;
    const directive = `/// <reference path="${normalized}" />`;
    await writeFile(dts, `${directive}\n${content}`, 'utf-8');
  }
}
