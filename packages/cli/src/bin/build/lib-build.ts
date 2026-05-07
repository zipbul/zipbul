import { mkdir } from 'fs/promises';
import { Glob } from 'bun';
import { dirname, join, resolve, relative } from 'path';

import type { CliRendererLike } from '../interfaces';
import type { BuildCommandDeps } from './interfaces';

import { extractSymbols, parseSource } from '@zipbul/gildash';
import { isErr } from '@zipbul/result';
import { validateDefineCallShape } from '../../compiler/define-call-shape';
import { withAtomicEmit, readBoundedStream, type CancellationScope } from '../../common';
import { buildDiagnostic, DiagnosticError } from '../../diagnostics';
import {
  extractLibAugments,
  injectAugmentsIntoSource,
  type LibAugmentEntry,
} from '../../compiler/generator/lib-augment-injector';

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
 * Resolved library build configuration from package.json.
 */
interface LibBuildConfig {
  readonly packageName: string;
  readonly srcDir: string;
  readonly outDir: string;
  readonly projectRoot: string;
}

/**
 * Library build mode (`zb build --lib`).
 *
 * Scans TypeScript source files for `defineMiddleware()` calls,
 * extracts augment metadata from factory bodies, and injects
 * `__augments` fields into the compiled JS output.
 *
 * Consumers of the published npm package can then read augment
 * metadata from the IR without needing TypeScript source access.
 *
 * @public
 */
export async function buildLib(
  deps: BuildCommandDeps,
  renderer: CliRendererLike,
  buildStartedAt: number,
  cancel?: CancellationScope,
): Promise<void> {
  const projectRoot = process.cwd();

  // ── 1. Read package.json ────────────────────────────────────
  const config = await resolveLibBuildConfig(projectRoot);

  renderer.outputPaths('\u{1F4E6} Library build', [
    { label: 'Package', value: config.packageName },
    { label: 'Source', value: relative(projectRoot, config.srcDir) || '.' },
    { label: 'Output', value: relative(projectRoot, config.outDir) || '.' },
  ]);

  // ── 2. Scan source files ────────────────────────────────────
  const scanSpinner = renderer.startSpinner('[1/4] Scanning source files');

  const glob = new Glob('**/*.ts');
  const allFiles = await deps.scanFiles({ glob, baseDir: config.srcDir });
  const tsFiles = allFiles.filter(
    f => !f.endsWith('.d.ts') && !f.endsWith('.spec.ts') && !f.endsWith('.test.ts'),
  );

  if (tsFiles.length === 0) {
    scanSpinner.stop('[1/4] Scanning source files');
    throw new DiagnosticError(buildDiagnostic({
      reason: `No TypeScript source files found in ${relative(projectRoot, config.srcDir) || '.'}. Verify the source directory.`,
    }));
  }

  scanSpinner.stop(`[1/4] Scanned ${String(tsFiles.length)} source files`);

  // Validate that every `defineX` call in the package follows the
  // `export const X = defineX(...)` shape — single normative rule, no other
  // call site is allowed. Runs before augment extraction so the extractor can
  // assume the well-formed shape.
  const shapeInputs = await Promise.all(tsFiles.map(async file => {
    const fullPath = join(config.srcDir, file);
    const sourceText = await Bun.file(fullPath).text();
    const parsed = parseSource(fullPath, sourceText);
    if (isErr(parsed)) {
      throw new DiagnosticError(buildDiagnostic({
        reason: `Failed to parse ${fullPath} for shape validation: ${JSON.stringify(parsed.data)}`,
        file: fullPath,
      }));
    }
    return { filePath: relative(projectRoot, fullPath) || fullPath, parsed };
  }));
  validateDefineCallShape(shapeInputs);

  // ── 3. Extract augments and inject ──────────────────────────
  const augmentSpinner = renderer.startSpinner('[2/4] Extracting middleware augments');

  const reports: FileAugmentReport[] = [];
  const transformedFiles = new Map<string, string>();
  let totalAugments = 0;
  let totalSkipped = 0;

  for (const file of tsFiles) {
    const fullPath = join(config.srcDir, file);
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

    const transformed = injectAugmentsIntoSource(sourceText, entries);

    // Validate the transformed source parses correctly
    if (entries.length > 0) {
      const parseCheck = parseSource(fullPath, transformed);

      if (isErr(parseCheck)) {
        augmentSpinner.stop('[2/4] Extracting middleware augments');
        throw new DiagnosticError(buildDiagnostic({
          reason: `Augment injection produced invalid syntax in ${file}. This is a Zipbul compiler bug — please report it.`,
          file: fullPath,
        }));
      }
    }

    transformedFiles.set(file, transformed);
  }

  augmentSpinner.stop(`[2/4] Extracted augments from ${String(totalAugments)} middleware exports`);

  // Report skipped middlewares
  for (const report of reports) {
    for (const skip of report.skipped) {
      renderer.warn(`${report.file}: ${skip.name} — ${skip.reason}`);
    }
  }

  if (totalAugments === 0 && totalSkipped === 0) {
    renderer.warn('No defineMiddleware() exports with context augments found. If this is a middleware library, verify your factory uses ctx.to() and assigns to context properties.');
  }

  // ── 4·5. Atomic emit: Bun.build (JS) + tsc (.d.ts) → staging → swap ──
  // Both stages write into a staging dir; on success, staging atomically
  // replaces config.outDir. On any failure the prior dist/ is preserved.
  const compileSpinner = renderer.startSpinner('[3/4] Compiling to JavaScript');
  const { rm } = await import('fs/promises');

  await withAtomicEmit(
    {
      finalDir: config.outDir,
      stagingDir: `${config.outDir}.staging`,
      ...(cancel !== undefined ? { registerCleanup: cancel.registerCleanup } : {}),
    },
    async (stagingDir) => {
      // Transformed source goes into a temp dir alongside staging (siblings,
      // not nested) so tempSrc removal cannot affect staging contents.
      const tempSrcDir = `${config.outDir}.lib-build-tmp`;
      await rm(tempSrcDir, { recursive: true, force: true });
      await mkdir(tempSrcDir, { recursive: true });

      try {
        for (const [file, content] of transformedFiles) {
          const outPath = join(tempSrcDir, file);
          await mkdir(dirname(outPath), { recursive: true });
          await Bun.write(outPath, content);
        }

        const entrypoints = resolveEntrypoints(tsFiles, tempSrcDir);

        const buildResult = await deps.buildBundle({
          entrypoints,
          outdir: stagingDir,
          root: tempSrcDir,
          target: 'bun',
          format: 'esm',
          packages: 'external',
          minify: { whitespace: true, syntax: true },
          splitting: true,
        });

        if (!buildResult.success) {
          compileSpinner.stop('[3/4] Compiling to JavaScript');
          const errors = buildResult.logs
            .filter(log => log.level === 'error')
            .map(log => log.message)
            .join('\n');
          throw new DiagnosticError(buildDiagnostic({
            reason: `JavaScript compilation failed:\n${errors}`,
          }));
        }

        compileSpinner.stop(`[3/4] Compiled ${String(buildResult.outputs.length)} files`);
      } finally {
        await rm(tempSrcDir, { recursive: true, force: true }).catch(() => {});
      }

      // ── tsc .d.ts emission into the same staging dir ──
      const dtsSpinner = renderer.startSpinner('[4/4] Generating type declarations');

      // 5 minute hard cap — matches adapter-build's TSC_TIMEOUT_MS. Hung tsc
      // is the most common cause of stalled lib builds; failing fast lets
      // CI surface the issue instead of consuming the whole job time budget.
      const TSC_TIMEOUT_MS = 5 * 60 * 1000;

      const proc = Bun.spawn(
        ['bunx', 'tsc', '--declaration', '--emitDeclarationOnly', '--outDir', stagingDir],
        {
          cwd: projectRoot,
          stderr: 'pipe',
          stdout: 'pipe',
          ...(cancel !== undefined ? { signal: cancel.signal } : {}),
        },
      );

      const timeoutHandle = setTimeout(() => {
        try { proc.kill('SIGTERM'); } catch { /* already dead */ }
      }, TSC_TIMEOUT_MS);

      let exitCode: number | null;
      try {
        exitCode = await proc.exited;
      } finally {
        clearTimeout(timeoutHandle);
      }

      if (exitCode !== 0) {
        dtsSpinner.stop('[4/4] Generating type declarations');
        // 4MB cap mirrors adapter-build's `runTsc` — a runaway tsc must not
        // OOM the parent through unbounded `await new Response(s).text()`.
        const stderrText = proc.stderr
          ? await readBoundedStream(proc.stderr as ReadableStream<Uint8Array>, 4 * 1024 * 1024)
          : '';
        const reason = exitCode === null
          ? `tsc terminated by signal (likely timeout after ${String(TSC_TIMEOUT_MS / 1000)}s or external cancel).`
          : `Type declaration generation failed (tsc exit code ${String(exitCode)}):\n${stderrText.trim().slice(0, 1000)}`;
        throw new DiagnosticError(buildDiagnostic({ reason }));
      }

      dtsSpinner.stop('[4/4] Type declarations generated');
    },
  );

  // ── Summary ────────────────────────────────────────────────
  if (totalAugments > 0) {
    renderer.separator();

    for (const report of reports) {
      for (const mw of report.middlewares) {
        renderer.step(`${mw.name} (${mw.contextType}) — ${String(mw.augmentCount)} augment(s)`);
      }
    }
  }

  const elapsed = ((performance.now() - buildStartedAt) / 1000).toFixed(2);

  renderer.outro(`Library built in ${elapsed}s`);
}

/**
 * Reads package.json and resolves library build configuration.
 * No zipbul.json required — library builds use package.json only.
 */
async function resolveLibBuildConfig(projectRoot: string): Promise<LibBuildConfig> {
  const packageJsonPath = join(projectRoot, 'package.json');
  const packageJsonFile = Bun.file(packageJsonPath);

  if (!(await packageJsonFile.exists())) {
    throw new DiagnosticError(buildDiagnostic({
      reason: 'package.json not found. Run `zb build --lib` from the package root.',
      file: packageJsonPath,
    }));
  }

  // DoS guard: cap package.json at 5MB so a malformed input cannot exhaust
  // memory on parse. Real package.json files are well under this limit.
  const MAX_PACKAGE_JSON_BYTES = 5 * 1024 * 1024;
  if (packageJsonFile.size > MAX_PACKAGE_JSON_BYTES) {
    throw new DiagnosticError(buildDiagnostic({
      reason: `package.json exceeds the size limit (${String(packageJsonFile.size)} > ${String(MAX_PACKAGE_JSON_BYTES)} bytes).`,
      file: packageJsonPath,
    }));
  }

  let packageJson: Record<string, unknown>;

  try {
    packageJson = await packageJsonFile.json() as Record<string, unknown>;
  } catch {
    throw new DiagnosticError(buildDiagnostic({
      reason: 'Failed to parse package.json.',
      file: packageJsonPath,
    }));
  }

  const packageName = packageJson.name;

  if (typeof packageName !== 'string' || packageName.length === 0) {
    throw new DiagnosticError(buildDiagnostic({
      reason: 'package.json must have a "name" field.',
      file: packageJsonPath,
    }));
  }

  validateMiddlewareKind(packageJson, packageJsonPath);

  // Resolve source directory: package.json "source" field > "src/" > root
  const srcDir = await resolveSourceDir(projectRoot, packageJson);
  const outDir = resolve(projectRoot, 'dist');

  return { packageName, srcDir, outDir, projectRoot };
}

/**
 * `zb build --lib` only operates on packages that explicitly declare
 * `zipbul.kind === 'middleware'`. This makes the two compilers mutually
 * exclusive: an adapter package (`kind === 'adapter'`) cannot be compiled as
 * a middleware library, and vice-versa.
 */
function validateMiddlewareKind(packageJson: Record<string, unknown>, packageJsonPath: string): void {
  const zipbul = packageJson.zipbul;
  const kind = (zipbul !== null && typeof zipbul === 'object' && !Array.isArray(zipbul))
    ? (zipbul as { kind?: unknown }).kind
    : undefined;

  if (kind === 'middleware') return;

  throw new DiagnosticError(buildDiagnostic({
    reason: `[CONTRACT] \`zb build --lib\` only compiles middleware library packages. ${packageJsonPath} must declare \`"zipbul": { "kind": "middleware" }\`. Found: ${JSON.stringify(zipbul ?? null)}.`,
    file: packageJsonPath,
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
    }));
  }

  // Convention: src/
  const srcDir = join(projectRoot, 'src');

  if (await dirExists(srcDir)) return srcDir;

  // Convention: lib/
  const libDir = join(projectRoot, 'lib');

  if (await dirExists(libDir)) return libDir;

  throw new DiagnosticError(buildDiagnostic({
    reason: 'Cannot determine source directory. Add a "source" field to package.json (e.g., "source": "src/index.ts") or create a src/ directory.',
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
 * Uses `extractLibAugments` for augment extraction, then scans the same
 * parsed AST for `defineMiddleware` calls that produced no augments.
 */
function extractAndDetectSkipped(
  filePath: string,
  sourceText: string,
): { entries: LibAugmentEntry[]; skipped: SkippedMiddlewareReport[] } {
  const entries = extractLibAugments(filePath, sourceText);
  const successNames = new Set(entries.map(e => e.name));
  const skipped: SkippedMiddlewareReport[] = [];

  // Re-use the already-parsed AST via parseSource (extractLibAugments already parsed it;
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
 * Resolves entry points for Bun.build.
 * Uses all .ts files as entry points for unbundled library output.
 */
function resolveEntrypoints(tsFiles: readonly string[], srcDir: string): string[] {
  return tsFiles.map(file => join(srcDir, file));
}
