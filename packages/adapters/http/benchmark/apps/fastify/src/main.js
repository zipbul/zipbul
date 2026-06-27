import Fastify from 'fastify';

const port = Number(process.env['BENCH_PORT'] ?? 3000);
const app = Fastify({ logger: false });

app.get('/', () => ({ message: 'Hello, World!' }));

await app.listen({ port });

console.log(`Fastify listening on :${port}`);
