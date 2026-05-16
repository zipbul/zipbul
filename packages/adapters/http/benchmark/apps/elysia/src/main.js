import { Elysia } from 'elysia';

const port = Number(process.env['BENCH_PORT'] ?? 3000);

new Elysia()
  .get('/', () => ({ message: 'Hello, World!' }))
  .listen(port);

console.log(`Elysia listening on :${port}`);
