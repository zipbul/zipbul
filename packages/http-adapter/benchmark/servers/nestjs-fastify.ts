import 'reflect-metadata';
import { Module, Controller, Get } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';

const port = Number(process.env['BENCH_PORT'] ?? 3000);

@Controller('/')
class BenchController {
  @Get()
  json() {
    return { message: 'Hello, World!' };
  }
}

@Module({ controllers: [BenchController] })
class AppModule {}

const app = await NestFactory.create(AppModule, new FastifyAdapter(), { logger: false });
await app.listen(port);

console.log(`NestJS+Fastify listening on :${port}`);
