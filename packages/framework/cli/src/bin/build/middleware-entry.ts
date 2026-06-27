import { Glob } from 'bun';

import { installCancellation, scanGlobSorted } from '../../common';

import type { MiddlewareBuildDeps } from './middleware-build';
import { runMiddlewareBuild } from './middleware-build';

/**
 * Production entry point for `zb build middleware`. Wires real Bun-based
 * dependencies and a SIGINT/SIGTERM cancellation scope, then delegates to
 * {@link runMiddlewareBuild}.
 *
 * @public
 */
export async function buildMiddleware(): Promise<void> {
  const deps: MiddlewareBuildDeps = {
    scanFiles: ({ glob, baseDir }: { glob: Glob; baseDir: string }) => scanGlobSorted({ glob, baseDir }),
    buildBundle: (...args: Parameters<typeof Bun.build>) => Bun.build(...args),
  };

  const cancel = installCancellation();
  try {
    await runMiddlewareBuild(deps, cancel);
  } finally {
    cancel.dispose();
  }
}
