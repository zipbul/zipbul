import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const port = Number(process.env['BENCH_PORT'] ?? 3000);
  const app = await NestFactory.create(AppModule, new FastifyAdapter(), { logger: false });
  await app.listen(port);
  console.log(`NestJS+Fastify listening on :${port}`);
}

bootstrap().catch(error => {
  console.error(error);
  process.exit(1);
});
