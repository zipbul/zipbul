export class EntryGenerator {
  generate(userMainImportPath: string, isDev: boolean): string {
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
