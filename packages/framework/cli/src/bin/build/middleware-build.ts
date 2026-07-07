import { readdir, readFile, writeFile } from 'fs/promises';
import { Glob } from 'bun';
import { dirname, join, resolve, relative } from 'path';

import type { BuildCommandDeps } from './interfaces';

/**
 * The dependencies `zb build middleware` actually uses — a narrow slice of
 * {@link BuildCommandDeps} so callers and tests wire exactly what runs.
 */
export type MiddlewareBuildDeps = Pick<BuildCommandDeps, 'scanFiles'>;

import { parseSource, is, buildLineOffsets, getLineColumn } from '@zipbul/gildash';
import type { Node as AstNode } from '@zipbul/gildash';
import { isErr } from '@zipbul/result';
import { Logger } from '@zipbul/logger';
import {
  validateMiddlewareLibraryShape,
  type DiscoveredMiddleware,
} from '../../compiler/middleware-shape';
import type { DefineCallShapeInput } from '../../compiler/define-call-shape';
import {
  extractDefinitionParts,
  findContextAssignmentStart,
  readFactoryContextType,
  type ExtractedAugment,
} from '../../compiler/analyzer/parser/augments-slot-extractor';
import { extractMiddlewareContextOps } from '../../compiler/analyzer/parser/context-operation-extractor';
import { withAtomicEmit, runTsgo, type CancellationScope } from '../../common';
import { buildDiagnostic, DiagnosticError } from '../../diagnostics';
import {
  CONTEXT_AUGMENTS_MANIFEST_VERSION,
  renderContextAugmentsDts,
  type AugmentDtsMember,
  type ContextAugmentsManifest,
  type ManifestMiddleware,
  type ResolvedAugmentTarget,
} from './middleware-augments-emitter';

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
 * Discovers `defineMiddleware()` exports per the shape grammar v2 (FORM 1
 * `export const` / FORM 2 exported factory function), reads their declarative
 * `augments` slots, then emits:
 *
 * - `dist/context-augments.d.ts` — declaration merging so consumers of the
 *   published package gain typed context augmentation with zero tsconfig
 *   changes (every tsgo-emitted `.d.ts` gets a `/// <reference path>`).
 * - `dist/context-augments.json` — the versioned manifest the app AOT
 *   compiler reads from node_modules (accessor registry + contextOps).
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

  // ── 3. Parse + shape grammar v2 + discovery ─────────────────
  // `defineMiddleware` must appear as FORM 1 (`export const x = ...`) or
  // FORM 2 (exported factory function with exactly one definition-bearing
  // return site); the other defineX callees keep the strict FORM 1 rule.
  // The validator doubles as the discovery walker — it returns every
  // discovered middleware export per file.
  const shapeInputs: DefineCallShapeInput[] = await Promise.all(sourceFiles.map(async file => {
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
  const discovered = validateMiddlewareLibraryShape(shapeInputs);

  // ── 4. Extract augments slots + contextOps per middleware ───
  log.time('extract');

  const extraction = await extractPackageMiddlewares({
    projectRoot,
    shapeInputs,
    discovered,
  });

  log.info('extracted %d middleware export(s), %d augment(s)',
    extraction.manifest.middlewares.length,
    extraction.manifest.middlewares.reduce((sum, m) => sum + m.augments.length, 0));
  log.timeEnd('extract');

  if (extraction.manifest.middlewares.length === 0) {
    log.warn('no defineMiddleware() exports found; if this is a middleware library, verify your defineMiddleware calls follow the shape grammar (FORM 1 `export const` / FORM 2 exported factory function)');
  }

  const dtsContent = renderContextAugmentsDts(extraction.dtsMembers, projectRoot);

  // ── 5. Atomic emit: tsgo (JS + .d.ts) → staging → swap ──
  // tsgo compiles JS and `.d.ts` in one type-checked per-file pass (no bundle),
  // driven by the package's `tsconfig.build.json`. Unbundled per-file output
  // avoids Bun's bundler corrupting `export *` re-export barrels and loads in
  // Bun at runtime as-is. The augments are declarative (no source-context
  // assignments), so the sources type-check standalone — the generated
  // artifacts are written straight into staging after tsgo.
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
      // Write the generated augments file into staging as
      // `context-augments.d.ts` and prepend `/// <reference path>` to every
      // `.d.ts` file tsgo just emitted. Consumers importing the middleware
      // pick up the augmentation automatically — no consumer tsconfig
      // modification.
      if (dtsContent !== null) {
        await finalizeContextAugmentsDts({ stagingDir, dtsContent });
      }

      // ── Versioned manifest (app AOT channel) ──
      if (extraction.manifest.middlewares.length > 0) {
        await writeFile(
          join(stagingDir, 'context-augments.json'),
          `${JSON.stringify(extraction.manifest, null, 2)}\n`,
          'utf-8',
        );
      }
    },
  );

  // ── Summary ────────────────────────────────────────────────
  for (const mw of extraction.manifest.middlewares) {
    log.info('middleware %s form=%d contextType=%s augments=%d contextOps=%d',
      mw.exportName, mw.form, mw.contextType ?? '(none)', mw.augments.length, mw.contextOps.length);
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

/** Aggregated static extraction over the whole package. */
interface PackageExtraction {
  readonly manifest: ContextAugmentsManifest;
  readonly dtsMembers: readonly AugmentDtsMember[];
}

/**
 * Runs the fixed-slot extractor + assignment-violation detector over every
 * discovered middleware, resolves augment namespaces through the adapters'
 * `dist/context-namespaces.json`, and assembles the manifest + `.d.ts`
 * member list. Every unresolvable step is a hard `DiagnosticError`.
 */
async function extractPackageMiddlewares(params: {
  projectRoot: string;
  shapeInputs: readonly DefineCallShapeInput[];
  discovered: ReadonlyMap<string, readonly DiscoveredMiddleware[]>;
}): Promise<PackageExtraction> {
  const { projectRoot, shapeInputs, discovered } = params;

  const inputByPath = new Map(shapeInputs.map(f => [f.filePath, f]));
  const adapterManifestCache = new Map<string, Awaited<ReturnType<typeof loadAdapterNamespaces>>>();
  const middlewares: ManifestMiddleware[] = [];
  const dtsMembers: AugmentDtsMember[] = [];

  for (const [filePath, fileMiddlewares] of discovered) {
    const file = inputByPath.get(filePath);

    if (file === undefined) continue;

    const importMap = buildSourceImportMap(file.parsed.program.body);
    const lineOffsets = buildLineOffsets(file.parsed.sourceText);

    for (const mw of fileMiddlewares) {
      const augments: ExtractedAugment[] = [];
      const contextOps: Array<{ kind: 'set' | 'use' | 'get'; keyIdentifier: string | null }> = [];
      const adapterNames = new Set<string>();
      let fallbackContextType: string | null = null;

      for (const call of mw.calls) {
        const parts = extractDefinitionParts({ file, call, exportName: mw.exportName });

        for (const name of parts.adapters) adapterNames.add(name);

        if (parts.factory !== null) {
          const offending = findContextAssignmentStart(parts.factory);

          if (offending !== null) {
            const { line, column } = getLineColumn(lineOffsets, offending);

            throw new DiagnosticError(buildDiagnostic({
              reason: `${filePath}:${line}:${column} \`${mw.exportName}\`: assignment-style context augments (\`ctx.to(...)\` binding property assignment) are no longer supported.`,
              file: filePath,
              how: 'Declare the contribution in the defineMiddleware `augments` slot instead: `augments: { request: { myProp: (ctx) => ... } }`.',
            }));
          }

          contextOps.push(...extractMiddlewareContextOps(parts.factory)
            .map(op => ({ kind: op.kind, keyIdentifier: op.keyIdentifier })));

          fallbackContextType ??= readFactoryContextType(parts.factory);
        }

        // Multi-definition rule: at most one definition per (ns, prop)
        // across a FORM 2 object return.
        for (const augment of parts.augments) {
          const duplicate = augments.find(a => a.ns === augment.ns && a.prop === augment.prop);

          if (duplicate !== undefined) {
            throw new DiagnosticError(buildDiagnostic({
              reason: `\`${mw.exportName}\` declares \`augments.${augment.ns}.${augment.prop}\` on more than one definition — at most one definition per (ns, prop) is allowed.`,
              file: filePath,
              how: 'Move the augment onto a single definition of the returned object.',
            }));
          }

          augments.push(augment);
        }
      }

      let contextType = fallbackContextType;
      const manifestAugments: Array<ManifestMiddleware['augments'][number]> = [];

      if (augments.length > 0) {
        // Resolve each adapter class → package specifier → published
        // `dist/context-namespaces.json` (the normative ns → interface map).
        const adapterManifests: Array<NonNullable<Awaited<ReturnType<typeof loadAdapterNamespaces>>> & { specifier: string }> = [];

        for (const adapterName of adapterNames) {
          const specifier = importMap.get(adapterName);

          if (specifier === undefined || specifier.startsWith('.')) {
            throw new DiagnosticError(buildDiagnostic({
              reason: `\`${mw.exportName}\`: adapter class \`${adapterName}\` must be imported from an installed adapter package — augment namespaces are resolved through the adapter's published \`dist/context-namespaces.json\`.`,
              file: filePath,
              how: 'Import the adapter class from its package (e.g. `import { HttpAdapter } from "@zipbul/http-adapter"`).',
            }));
          }

          let manifest = adapterManifestCache.get(specifier);

          if (manifest === undefined) {
            manifest = await loadAdapterNamespaces(projectRoot, specifier);
            adapterManifestCache.set(specifier, manifest);
          }

          if (manifest === null) {
            throw new DiagnosticError(buildDiagnostic({
              reason: `\`${mw.exportName}\`: adapter package "${specifier}" ships no \`dist/context-namespaces.json\` — augment namespaces cannot be resolved.`,
              file: filePath,
              how: 'Install the adapter package (or upgrade it to a version built with `zb build adapter`, which emits the manifest).',
            }));
          }

          adapterManifests.push({ ...manifest, specifier });
        }

        for (const augment of augments) {
          const target = resolveAugmentTarget(augment.ns, adapterManifests);

          if (target === null) {
            const available = adapterManifests
              .map(m => `${m.specifier}: [${Object.keys(m.namespaces).join(', ')}]`)
              .join('; ');

            throw new DiagnosticError(buildDiagnostic({
              reason: `\`${mw.exportName}\`: augment namespace \`${augment.ns}\` does not exist on any declared adapter context. Available namespaces — ${available}.`,
              file: filePath,
              how: 'Use a namespace the adapter declares (see the adapter\'s dist/context-namespaces.json), or add the adapter that provides it to `adapters`.',
            }));
          }

          contextType ??= target.contextType;

          dtsMembers.push({
            target,
            prop: augment.prop,
            kind: augment.kind,
          });

          manifestAugments.push({
            ns: augment.ns,
            prop: augment.prop,
            kind: augment.kind,
          });
        }
      }

      middlewares.push({
        exportName: mw.exportName,
        form: mw.form,
        contextType,
        augments: manifestAugments,
        contextOps,
      });
    }
  }

  return {
    manifest: { version: CONTEXT_AUGMENTS_MANIFEST_VERSION, middlewares },
    dtsMembers,
  };
}

/** First declared adapter whose context schema contains the namespace. */
function resolveAugmentTarget(
  ns: string,
  adapterManifests: ReadonlyArray<{ specifier: string; contextType: string; namespaces: Readonly<Record<string, string>> }>,
): ResolvedAugmentTarget | null {
  for (const manifest of adapterManifests) {
    const iface = manifest.namespaces[ns];

    if (iface !== undefined) {
      return { module: manifest.specifier, interface: iface, contextType: manifest.contextType };
    }
  }

  return null;
}

/**
 * Builds an import map from a parsed file's import declarations:
 * `localBindingName → moduleSpecifier`. Used to resolve adapter class
 * identifiers to their owning package specifier.
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
 * Reads the adapter's `dist/context-namespaces.json` from `node_modules` to
 * map namespace names (e.g. `'request'`) to TypeScript interface names
 * (e.g. `'HttpRequest'`) plus the adapter context class name.
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

/**
 * Writes the generated augments `.d.ts` into staging as
 * `context-augments.d.ts` and prepends `/// <reference path>` to every
 * tsgo-emitted `.d.ts` file in staging.
 */
async function finalizeContextAugmentsDts(params: {
  stagingDir: string;
  dtsContent: string;
}): Promise<void> {
  const { stagingDir, dtsContent } = params;
  const stagingAugmentsPath = join(stagingDir, 'context-augments.d.ts');
  await writeFile(stagingAugmentsPath, dtsContent, 'utf-8');

  await prependReferenceToAllDts(stagingDir);
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
