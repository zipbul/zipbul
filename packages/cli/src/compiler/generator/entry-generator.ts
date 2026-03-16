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

const logger = new Logger('Entry');

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
}
