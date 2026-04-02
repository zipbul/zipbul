import 'reflect-metadata';
import { Module, Controller, Get } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

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

const app = await NestFactory.create(AppModule, { logger: false });
await app.listen(port);

console.log(`NestJS+Express listening on :${port}`);
