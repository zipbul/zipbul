import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

import { pathExists } from './path-exists';

/**
 * Compiles a package with tsgo (`@typescript/native-preview`) into `outDir`.
 *
 * tsgo is a single per-file pass that emits BOTH JavaScript and `.d.ts` and
 * full-type-checks the source — replacing the old `Bun.build` + `tsc` pair.
 * It emits unbundled output (an `index.js` re-exporting `./src/*.js`), which
 * avoids Bun's bundler corrupting `export *` re-export barrels and is loadable
 * by Bun at runtime as-is.
 *
 * Driven by the package's `tsconfig.build.json` (`include`/`rootDir`); the
 * compiler is pointed at `outDir` via `--outDir`.
 *
 * @throws when tsgo exits non-zero (type errors / emit failure) or is aborted.
 */
export async function runTsgo(
  packageRoot: string,
  tsconfigPath: string,
  outDir: string,
  signal?: AbortSignal,
): Promise<void> {
  const tsgoBin = await resolveTsgoBin(packageRoot);
  const args = tsgoBin === 'bunx'
    ? ['tsgo', '-p', tsconfigPath, '--outDir', outDir]
    : ['-p', tsconfigPath, '--outDir', outDir];

  await new Promise<void>((resolveFn, rejectFn) => {
    const child = spawn(tsgoBin, args, {
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
      settle(() => rejectFn(new Error(`tsgo invocation aborted (signal received) for ${tsconfigPath}.`)));
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
      settle(() => rejectFn(new Error(`tsgo exited with code ${String(code)} for ${tsconfigPath}:\n${message}`)));
    });
  });
}

/**
 * Resolves a usable `tsgo` executable. Walks up from `packageRoot` looking for
 * `node_modules/.bin/tsgo`, then from this module's own location (so a package
 * being built outside the CLI's tree — e.g. a consumer middleware, or a temp
 * fixture — still finds the `tsgo` shipped with the CLI). Falls back to
 * `bunx tsgo`.
 */
async function resolveTsgoBin(packageRoot: string): Promise<string> {
  for (const start of [packageRoot, import.meta.dir]) {
    let dir = start;
    for (let i = 0; i < 12; i += 1) {
      const candidate = join(dir, 'node_modules', '.bin', 'tsgo');
      if (await pathExists(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  return 'bunx';
}
