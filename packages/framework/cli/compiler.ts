import { stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { build as runBuildCommand } from './src/bin/build';

/**
 * Programmatic API for invoking the AOT compiler in-process.
 *
 * The CLI binary `zb build` is a thin wrapper around the same orchestration
 * function. `@zipbul/testing` imports {@link compile} directly so tests
 * never spawn a child process and never require a separate `bun run build`
 * step before `bun test`.
 *
 * @public
 */
export interface CompileOptions {
  /** Absolute path to the user's project root (the directory holding `zipbul.config.{ts,json}`). */
  readonly projectRoot: string;
  /** Force rebuild even when the existing manifest looks fresh. */
  readonly force?: boolean;
}

export interface CompileResult {
  /** Absolute path to `.zipbul-temp/runtime.ts` (the AOT-emitted runtime). */
  readonly runtimePath: string;
  /** Absolute path to `.zipbul/manifest.json`. */
  readonly manifestPath: string;
  /** True when the existing artifacts were reused (no recompilation took place). */
  readonly fromCache: boolean;
}

/**
 * Runs the AOT compiler against {@link CompileOptions.projectRoot}. Reuses
 * the existing artifacts when {@link isManifestFresh} reports true and
 * `force` is false.
 *
 * The CLI command internally calls `process.cwd()`; this wrapper
 * `chdir()`s into the project root for the duration of the build and
 * restores the original cwd in `finally`.
 *
 * @public
 */
/**
 * Process-scoped in-memory cache. The Bun test runner reuses the same
 * process across multiple test files; without this cache, every file's
 * `Test.create` would re-invoke the compiler, hammering Bun.build's
 * atomic-emit lock and producing race-prone artifacts.
 *
 * The cache keys on the resolved project root. `force: true` bypasses it.
 */
const compileCache = new Map<string, CompileResult>();

export async function compile(opts: CompileOptions): Promise<CompileResult> {
  const runtimePath = join(opts.projectRoot, '.zipbul-temp', 'runtime.ts');
  const manifestPath = join(opts.projectRoot, '.zipbul', 'manifest.json');

  if (opts.force !== true) {
    const cached = compileCache.get(opts.projectRoot);
    if (cached !== undefined) return cached;
    if (await isManifestFresh(opts.projectRoot)) {
      const result: CompileResult = { runtimePath, manifestPath, fromCache: true };
      compileCache.set(opts.projectRoot, result);
      return result;
    }
  }

  const originalCwd = process.cwd();
  process.chdir(opts.projectRoot);
  try {
    await runBuildCommand({ verbose: false });
  } finally {
    process.chdir(originalCwd);
  }

  const result: CompileResult = { runtimePath, manifestPath, fromCache: false };
  compileCache.set(opts.projectRoot, result);
  return result;
}

/**
 * Returns true when `.zipbul/manifest.json` exists and its mtime is at
 * or after the newest `.ts` file under the project's `src/` directory.
 * A missing manifest, or any source file newer than the manifest, makes
 * the answer false — the caller should re-run {@link compile}.
 *
 * @public
 */
export async function isManifestFresh(projectRoot: string): Promise<boolean> {
  // runtime.ts is the only artifact the toolkit consumes directly and the
  // only one the compiler re-emits unconditionally on every run (manifest
  // .json uses writeIfChanged, so its mtime stays stable when nothing in
  // the source graph affects the JSON shape). Comparing runtime.ts mtime
  // to the newest source mtime gives a reliable staleness signal.
  const runtimePath = join(projectRoot, '.zipbul-temp', 'runtime.ts');

  let runtimeMtime: number;
  try {
    const rs = await stat(runtimePath);
    runtimeMtime = rs.mtimeMs;
  } catch {
    return false;
  }

  const sourceDir = join(projectRoot, 'src');
  let newestSrc: number;
  try {
    newestSrc = await findNewestMtime(sourceDir);
  } catch {
    // No source dir → can't compile against this project. Existing artifact
    // is the best we have; trust it.
    return true;
  }

  return runtimeMtime >= newestSrc;
}

async function findNewestMtime(dir: string): Promise<number> {
  let newest = 0;
  const stack: string[] = [dir];

  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
      try {
        const s = await stat(full);
        if (s.mtimeMs > newest) newest = s.mtimeMs;
      } catch {
        // ignore unreadable file
      }
    }
  }

  return newest;
}
