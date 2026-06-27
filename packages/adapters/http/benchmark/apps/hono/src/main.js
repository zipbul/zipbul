import { Hono } from 'hono';

const port = Number(process.env['BENCH_PORT'] ?? 3000);
const app = new Hono();

app.get('/', (context) => context.json({ message: 'Hello, World!' }));

Bun.serve({
  port,
  reusePort: true,
  fetch: app.fetch,
});

console.log(`Hono listening on :${port}`);
