import { join } from 'node:path';

import { diag } from './diag';
import { pathExists, runTsgo } from '../../common';

/**
 * Compiles the adapter's TS → JS + `.d.ts` into the staging directory with
 * tsgo (`@typescript/native-preview`), a single per-file pass that emits both
 * JavaScript and declarations and full-type-checks the source.
 *
 * Driven by the package's `tsconfig.build.json` (`include`/`outDir`); the
 * compiler is pointed at `<staging>` via `--outDir`. Packages without a
 * `tsconfig.build.json` (e.g. internal-only fixtures) still get manifest
 * emission — codegen simply skips.
 *
 * Unlike the previous `Bun.build` path, tsgo emits unbundled per-file output
 * (an `index.js` re-exporting `./src/*.js`). This avoids Bun's bundler
 * corrupting `export *` re-export barrels, and the resulting dist is loadable
 * by Bun at runtime as-is.
 */
export async function runCodegen(packageRoot: string, stagingDir: string, signal?: AbortSignal): Promise<void> {
  const tsconfigBuildPath = join(packageRoot, 'tsconfig.build.json');

  if (!(await pathExists(tsconfigBuildPath))) {
    return;
  }

  if (signal?.aborted === true) {
    throw diag({ reason: 'Adapter codegen aborted before compile (signal received).', file: tsconfigBuildPath });
  }

  try {
    await runTsgo(packageRoot, tsconfigBuildPath, stagingDir, signal);
  } catch (error) {
    throw diag({
      reason: error instanceof Error ? error.message : String(error),
      file: tsconfigBuildPath,
    });
  }
}
