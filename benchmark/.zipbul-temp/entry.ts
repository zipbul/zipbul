
import { Logger } from '@zipbul/logger';

const logger = new Logger('Entry');

await bootstrap();

async function bootstrap() {
  try {
    logger.info("Starting production server");

    const runtimeFileName = './runtime.js';
    await import(runtimeFileName);

    logger.info("Loading application module");

    await import("/home/revil/projects/zipbul/zipbul/benchmark/src/main.ts");

  } catch (err) {
    throw err;
  }
}
