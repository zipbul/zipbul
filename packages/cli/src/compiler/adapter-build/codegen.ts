import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

import { diag } from './diag';
import { pathExists } from './source-tree';
import { readPackageJson } from './package-validation';

/**
 * Runs the TS → JS bundle (`Bun.build`) and `tsc --emitDeclarationOnly`
 * into the staging directory.
 *
 * The published entrypoint is conventionally `<packageRoot>/index.ts` (the
 * barrel), not the `defineAdapter()`-bearing file. If absent, falls back to
 * `<packageRoot>/src/index.ts`.
 *
 * `.d.ts` emission is best-effort: when a `tsconfig.build.json` is present
 * at the package root we invoke `tsc` against it with `--outDir <staging>`;
 * otherwise we skip and leave it to the package's own build pipeline.
 */
export async function runCodegen(packageRoot: string, stagingDir: string, signal?: AbortSignal): Promise<void> {
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
    // fixtures) still get manifest emission; codegen simply skips.
    return;
  }

  if (signal?.aborted === true) {
    throw diag('IO', { reason: 'Adapter codegen aborted before bundle (signal received).', file: entryPath });
  }

  // `minify: { syntax, whitespace }` matches the existing convention shared
  // by the in-tree adapter build scripts. `identifiers: false` keeps exported
  // names readable for runtime introspection — the manifest references
  // identifiers by name.
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

  const tsconfigBuildPath = join(packageRoot, 'tsconfig.build.json');

  if (await pathExists(tsconfigBuildPath)) {
    await runTsc(packageRoot, tsconfigBuildPath, stagingDir, signal);
  }
}

async function runTsc(
  packageRoot: string,
  tsconfigPath: string,
  outDir: string,
  signal?: AbortSignal,
): Promise<void> {
  const tscBin = await resolveTscBin(packageRoot);
  // Pin tsbuildinfo to .zipbul/cache/<package>.tsbuildinfo so
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

  // When the project uses composite/references, tsc requires `--build` mode.
  // We probe the tsconfig and switch invocation accordingly. `--force` is
  // appended only on the first invocation (no `.tsbuildinfo` yet) — subsequent
  // runs preserve the incremental cache.
  const buildMode = await tsconfigNeedsBuildMode(tsconfigPath);
  const tsBuildInfoExists = await pathExists(tsBuildInfoFile);
  const buildModeArgs = tsBuildInfoExists
    ? ['--build', tsconfigPath]
    : ['--build', tsconfigPath, '--force'];
  const args = buildMode
    ? (tscBin === 'bunx' ? ['tsc', ...buildModeArgs] : buildModeArgs)
    : (tscBin === 'bunx' ? ['tsc', ...baseArgs] : baseArgs);

  await new Promise<void>((resolveFn, rejectFn) => {
    const child = spawn(tscBin, args, {
      cwd: packageRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let stdout = '';
    let settled = false;

    const settle = (action: () => void): void => {
      if (settled) return;
      settled = true;
      action();
    };

    const onAbort = (): void => {
      try { child.kill('SIGTERM'); } catch { /* already dead */ }
      settle(() => rejectFn(diag('IO', {
        reason: `tsc invocation aborted (signal received) for ${tsconfigPath}.`,
        file: tsconfigPath,
      })));
    };

    if (signal !== undefined) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });

    child.on('error', err => {
      if (signal !== undefined) signal.removeEventListener('abort', onAbort);
      settle(() => rejectFn(err));
    });
    child.on('close', code => {
      if (signal !== undefined) signal.removeEventListener('abort', onAbort);

      if (settled) return;

      if (code === 0) {
        settle(resolveFn);
        return;
      }

      const message = stderr.trim() !== '' ? stderr.trim() : stdout.trim();

      settle(() => rejectFn(diag('IO', {
        reason: `tsc exited with code ${code} for ${tsconfigPath}:\n${message}`,
        file: tsconfigPath,
      })));
    });
  });
}

/**
 * Detects whether the tsconfig forces `--build` mode. Returns true when the
 * JSON declares `compilerOptions.composite: true` or a non-empty `references`
 * array. Shallow JSON parse only; following `extends` chains is left for a
 * future slice.
 */
async function tsconfigNeedsBuildMode(tsconfigPath: string): Promise<boolean> {
  try {
    const text = await readFile(tsconfigPath, 'utf8');
    // tsconfig allows comments + trailing commas; tolerate via stripped JSON.
    const stripped = text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/[^\n]*/g, '$1')
      .replace(/,(\s*[}\]])/g, '$1');
    const parsed: unknown = JSON.parse(stripped);
    if (typeof parsed !== 'object' || parsed === null) return false;
    const obj = parsed as { compilerOptions?: unknown; references?: unknown };
    const compilerOptions = obj.compilerOptions;
    if (typeof compilerOptions === 'object'
        && compilerOptions !== null
        && (compilerOptions as { composite?: unknown }).composite === true) {
      return true;
    }
    if (Array.isArray(obj.references) && obj.references.length > 0) return true;
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
 * Falls back to `bunx tsc` when no local install is found.
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
