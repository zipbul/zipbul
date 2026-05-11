import { Glob } from 'bun';

import { AstParser, AdapterDefinitionResolver } from '../../compiler/analyzer';
import { ConfigLoader } from '../../config';
import { EntryGenerator, ManifestGenerator } from '../../compiler/generator';
import { installCancellation, scanGlobSorted } from '../../common';

import type { BuildCommandDeps } from './interfaces';
import { runMiddlewareBuild } from './middleware-build';

/**
 * Production entry point for `zb build middleware`. Wires real Bun-based
 * dependencies and a SIGINT/SIGTERM cancellation scope, then delegates to
 * {@link runMiddlewareBuild}.
 *
 * @public
 */
export async function buildMiddleware(): Promise<void> {
  const deps: BuildCommandDeps = {
    loadConfig: async () => {
      const result = await ConfigLoader.load();
      return { config: result.config, source: result.source };
    },
    createParser: () => new AstParser(),
    createManifestGenerator: () => new ManifestGenerator(),
    createEntryGenerator: () => new EntryGenerator(),
    createAdapterDefinitionResolver: () => new AdapterDefinitionResolver(),
    scanFiles: ({ glob, baseDir }: { glob: Glob; baseDir: string }) => scanGlobSorted({ glob, baseDir }),
    resolveImport: (specifier: string, fromDir: string) => Bun.resolveSync(specifier, fromDir),
    buildBundle: (...args: Parameters<typeof Bun.build>) => Bun.build(...args),
  };

  const cancel = installCancellation();
  try {
    await runMiddlewareBuild(deps, cancel);
  } finally {
    cancel.dispose();
  }
}
