// AOT-compiled benchmark app (GET / → JSON, no middleware)
// Port: BENCH_PORT env var (default 3000)
// Rebuild: cd benchmark && bunx zb build
await import('../../../../benchmark/dist/entry.js');
