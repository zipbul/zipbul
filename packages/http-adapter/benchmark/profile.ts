/**
 * Zipbul HTTP 파이프라인 마이크로벤치마크.
 * fetch() 핸들러를 직접 호출하여 네트워크 오버헤드 없이 순수 프레임워크 비용을 측정.
 */
import { bench, group, run } from 'mitata';
import { $ } from 'bun';
import { join } from 'node:path';

const BENCHMARK_APP_DIR = join(import.meta.dir, '../../../benchmark');
const ZIPBUL_URL = 'http://localhost:19999';
const BASELINE_URL = 'http://localhost:19998';
const EXPECTED_BODY = JSON.stringify({ message: 'Hello, World!' });

async function prepareZipbulBenchmark(): Promise<void> {
  await $`rm -rf ${join(BENCHMARK_APP_DIR, '.zipbul/cache')} ${join(BENCHMARK_APP_DIR, '.zipbul/manifest.json')} ${join(BENCHMARK_APP_DIR, '.zipbul/runtime-report.json')} ${join(BENCHMARK_APP_DIR, 'dist')}`.quiet();
  await $`bun run --cwd ${BENCHMARK_APP_DIR} build`.quiet();
}

async function waitForZipbul(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      const body = await response.text();

      if (response.status === 200 && body === EXPECTED_BODY) {
        return;
      }
    } catch {
    }

    await Bun.sleep(100);
  }

  throw new Error(`Zipbul benchmark app failed to become ready within ${timeoutMs}ms`);
}

// Zipbul AOT 앱을 부트스트랩 (서버가 BENCH_PORT에서 listen)
process.env['BENCH_PORT'] = '19999';
process.env['NODE_ENV'] = 'production';
await prepareZipbulBenchmark();
await import('../../../benchmark/dist/entry.js');
await waitForZipbul(ZIPBUL_URL, 5_000);

const baselineServer = Bun.serve({
  port: 19998,
  reusePort: true,
  fetch() {
    return Response.json({ message: 'Hello, World!' });
  },
});

// 워밍업
for (let i = 0; i < 1000; i++) {
  await (await fetch(`${ZIPBUL_URL}/`)).text();
  await (await fetch(`${BASELINE_URL}/`)).text();
}

group('loopback fetch: GET / → JSON', () => {
  bench('Bun.serve (baseline)', async () => {
    await (await fetch(`${BASELINE_URL}/`)).text();
  });

  bench('Zipbul (full pipeline)', async () => {
    await (await fetch(`${ZIPBUL_URL}/`)).text();
  });
});

group('object creation (no I/O)', () => {
  bench('Response.json()', () => {
    Response.json({ message: 'Hello, World!' });
  });

  bench('new Request()', () => {
    new Request('http://localhost/');
  });

  bench('new URL()', () => {
    new URL('http://localhost/');
  });

  bench('new Headers()', () => {
    new Headers();
  });

  bench('JSON.stringify()', () => {
    JSON.stringify({ message: 'Hello, World!' });
  });
});

import { AsyncLocalStorage } from 'async_hooks';
const als = new AsyncLocalStorage<unknown>();

group('async overhead', () => {
  bench('AsyncLocalStorage.run()', () => {
    als.run({}, () => {});
  });

  bench('await Promise.resolve()', async () => {
    await Promise.resolve();
  });

  bench('empty async function', async () => {
    await (async () => {})();
  });
});

await run({ avg: true, min_max: true, percentiles: true });

void baselineServer.stop();
process.exit(0);
