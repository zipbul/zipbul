const port = Number(process.env['BENCH_PORT'] ?? 3000);

Bun.serve({
  port,
  reusePort: true,
  fetch() {
    return Response.json({ message: 'Hello, World!' });
  },
});

console.log(`Bun.serve listening on :${port}`);
