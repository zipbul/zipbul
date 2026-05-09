export class EntryGenerator {
  /**
   * Generates the entry file content that bootstraps the application.
   *
   * @param userMainImportPath - Absolute path to the user's main application module.
   * @param isDev - Whether this is a dev mode build.
   * @returns Generated entry file content as a string.
   * @throws Error if the user main module file does not exist.
   * @public
   */
  async generate(userMainImportPath: string, isDev: boolean): Promise<string> {
    const exists = await Bun.file(userMainImportPath).exists();

    if (!exists) {
      throw new Error(
        `[Zipbul AOT] Entry file '${userMainImportPath}' does not exist. Check the 'entry' path in your configuration.`,
      );
    }

    return `
import { Logger } from '@zipbul/logger';

const logger = new Logger('compiler/entry-gen');

await bootstrap();

async function bootstrap() {
  try {
    logger.info("${isDev ? 'Starting dev server (AOT)' : 'Starting production server'}");

    const runtimeFileName = ${isDev ? "'./runtime.ts'" : "'./runtime.js'"};
    await import(runtimeFileName);

    logger.info("Loading application module");

    await import("${userMainImportPath}");

  } catch (err) {
    throw err;
  }
}
`;
  }

  /**
   * Generates the worker entry file for cluster mode.
   *
   * This file is the entrypoint for each Bun Worker thread.
   * It re-exports the ApplicationWorker from @zipbul/core which
   * sets up RPC handlers (init, bootstrap, destroy, getStats).
   *
   * The AOT runtime (runtime.js) is loaded via the Worker's `preload` option,
   * so registerBootstrapState() runs before this script executes.
   *
   * @returns Generated worker file content as a string.
   * @public
   */
  generateWorker(): string {
    return `import '@zipbul/core/worker';
`;
  }

  /**
   * Generates a lightweight runtime for the master process in cluster mode.
   *
   * The master process does not serve requests — it only manages workers.
   * This runtime registers minimal context (isAotRuntime flag only),
   * avoiding the full container/metadata/controller initialization.
   *
   * @returns Generated runtime-master file content as a string.
   * @public
   */
  generateRuntimeMaster(): string {
    return `import { registerBootstrapState } from '@zipbul/core';

registerBootstrapState({
  isAotRuntime: true,
});
`;
  }
}
