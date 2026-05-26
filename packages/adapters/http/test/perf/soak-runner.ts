/**
 * Standalone soak runner for the zipbul HTTP adapter.
 * Run via `bun run test/soak-runner.ts` from packages/http-adapter.
 *
 * Usage: SOAK_WARMUP=30 SOAK_LOAD=900 SOAK_CONC=500 bun run test/soak-runner.ts
 */
import { mock } from 'bun:test';
import type { ZipbulContainer, CompiledHandlerEntry } from '@zipbul/common';

type ProcessInternals = NodeJS.Process & {
  _getActiveHandles?: () => readonly unknown[];
  _getActiveRequests?: () => readonly unknown[];
};
type BunWithGc = typeof Bun & { gc: (force: boolean) => void };

import { loggerMockModule } from '@zipbul/logger/testing';

mock.module('@zipbul/logger', loggerMockModule());
const realCore = await import('@zipbul/core');
mock.module('@zipbul/core', () => ({
  ...realCore,
  ClusterManager: class {},
  getBootstrapState: () => ({ isAotRuntime: false, metadataRegistry: new Map() }),
}));

const HTTP_SRC = '/home/revil/projects/zipbul/zipbul/packages/http-adapter/src';
const { HttpAdapter } = await import(`${HTTP_SRC}/http-adapter`);
const { HttpServer } = await import(`${HTTP_SRC}/http-server`);
// HttpContext not needed in this runner; endpoints use plain controller handlers.
const { ServerSentEvent } = await import(`${HTTP_SRC}/server-sent-event`);
const { httpError } = await import(`${HTTP_SRC}/http-error`);

const WARMUP_MS = Number(process.env.SOAK_WARMUP ?? 30) * 1000;
const LOAD_MS = Number(process.env.SOAK_LOAD ?? 900) * 1000;
const CONCURRENCY = Number(process.env.SOAK_CONC ?? 500);
const PORT = Number(process.env.SOAK_PORT ?? 51340);
const SAMPLE_MS = 30_000;
const BASE = `http://127.0.0.1:${PORT}`;

class SoakController { [k: string]: unknown; }

const BIGBODY = new Uint8Array(256 * 1024);
for (let i = 0; i < BIGBODY.length; i++) BIGBODY[i] = i & 0xff;

const controllerInstance: Record<string, unknown> = {
  ping: () => ({ ok: 1 }),
  echo: (c: any) => c.request.body,
  stream: () => { async function* g() { for (let i = 0; i < 100; i++) yield `chunk-${i}\n`; } return g(); },
  sse: () => { async function* g() { for (let i = 0; i < 100; i++) yield new ServerSentEvent({ n: i }, { event: 'tick' }); } return g(); },
  thrower: () => httpError(500, 'boom'),
  big: (c: any) => { c.response.setHeader('content-type', 'application/octet-stream'); return BIGBODY; },
};
const controllerFactories = new Map<string, () => unknown>([['SoakController', () => controllerInstance]]);

type Def = readonly [string, string, string, ReadonlyArray<{name:string,arguments?:readonly unknown[]}>?];
const defs: Def[] = [
  ['Get', 'ping', 'ping'],
  ['Post', 'echo', 'echo'],
  ['Get', 'stream', 'stream', [{ name: 'ContentType', arguments: ['text/plain'] }]],
  ['Get', 'sse', 'sse', [{ name: 'Sse' }]],
  ['Get', 'throw', 'thrower'],
  ['Get', 'bigbody', 'big'],
];
const handlerIndex: CompiledHandlerEntry[] = defs.map(([m, p, n, opts]) => {
  const base = {
    id: `HttpAdapter:SoakController.${n}`, adapterId: 'HttpAdapter',
    controllerKey: 'SoakController', methodName: n,
    handlerDecorator: m, handlerDecoratorArgs: [p] as readonly unknown[],
    compiledPre: ['BeforeParse','ParseBody','BeforeValidate','Validation','Guard','BeforeHandle'] as readonly string[],
    compiledPost: ['WriteResponse','AfterHandle','Serialize','BeforeResponse'] as readonly string[],
  };
  if (opts !== undefined) {
    return { ...base, options: opts as NonNullable<CompiledHandlerEntry['options']> };
  }
  return base;
});
const metadata = new Map();
metadata.set(SoakController, { className: 'SoakController', decorators: [{ name: 'RestController', arguments: [] }] });

const adapter = new HttpAdapter({ port: PORT, bodyLimit: 1024 * 1024 });
const container = { get: () => undefined, set: () => {}, has: () => false, getInstances: function*(){}, keys: function*(){} } as unknown as ZipbulContainer;
adapter.initializePipeline(container);
const server = new HttpServer();
await server.boot(container, { port: PORT, bodyLimit: 1024*1024, metadata: metadata as never, handlerIndex, controllerFactories } as never, adapter as never);

// Verify
{
  const r1 = await fetch(`${BASE}/ping`); await r1.arrayBuffer(); if (r1.status !== 200) throw new Error('ping');
  const r2 = await fetch(`${BASE}/echo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"x":1}' }); await r2.arrayBuffer(); if (r2.status !== 200) throw new Error('echo');
  const r3 = await fetch(`${BASE}/stream`); await r3.arrayBuffer(); if (r3.status !== 200) throw new Error('stream');
  const r4 = await fetch(`${BASE}/sse`); await r4.arrayBuffer(); if (r4.status !== 200) throw new Error('sse');
  const r5 = await fetch(`${BASE}/throw`); await r5.arrayBuffer(); if (r5.status !== 500) throw new Error('throw');
  const r6 = await fetch(`${BASE}/bigbody`); const b = await r6.arrayBuffer(); if (r6.status !== 200 || b.byteLength !== BIGBODY.length) throw new Error('big');
  console.log('[soak] endpoints verified');
}

let completed = 0, errors = 0;
const errorTypes = new Map<string, number>();
const samples: Array<any> = [];

process.on('unhandledRejection', (r) => { errors++; const k = 'unhandledRejection:' + String(r).slice(0,80); errorTypes.set(k, (errorTypes.get(k)??0)+1); });
process.on('uncaughtException', (e) => { errors++; const k = 'uncaughtException:' + e.message.slice(0,80); errorTypes.set(k, (errorTypes.get(k)??0)+1); });

const snap = (phase: string) => {
  const mu = process.memoryUsage();
  const proc = process as ProcessInternals;
  const h = proc._getActiveHandles?.().length ?? -1;
  const q = proc._getActiveRequests?.().length ?? -1;
  const m = server.getMetrics?.();
  samples.push({ t: Date.now(), phase, mu, handles: h, reqs: q, metrics: m, completed, errors });
  console.log(`[${phase}] rss=${(mu.rss/1048576).toFixed(1)}M heap=${(mu.heapUsed/1048576).toFixed(1)}M ext=${(mu.external/1048576).toFixed(1)}M ab=${(mu.arrayBuffers/1048576).toFixed(1)}M handles=${h} reqs=${q} metrics=${JSON.stringify(m)} completed=${completed} errors=${errors}`);
};

const endpoints = [
  () => fetch(`${BASE}/ping`),
  () => fetch(`${BASE}/echo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1,"b":"x"}' }),
  () => fetch(`${BASE}/stream`),
  () => fetch(`${BASE}/sse`),
  () => fetch(`${BASE}/throw`),
  () => fetch(`${BASE}/bigbody`),
];

let stop = false;
const workerPromises: Promise<void>[] = [];
for (let w = 0; w < CONCURRENCY; w++) {
  const id = w;
  workerPromises.push((async () => {
    let i = id;
    while (!stop) {
      try {
        const r = await endpoints[i % endpoints.length]!();
        await r.arrayBuffer();
        completed++;
      } catch (e: any) {
        errors++;
        const k = 'fetch:' + (e?.message ?? String(e)).slice(0, 80);
        errorTypes.set(k, (errorTypes.get(k) ?? 0) + 1);
      }
      i++;
    }
  })());
}

snap('baseline');

const sampler = setInterval(() => snap('load'), SAMPLE_MS);

// total run time: WARMUP_MS + LOAD_MS
// Snapshot right after warmup
setTimeout(() => snap('after-warmup'), WARMUP_MS);
await new Promise(r => setTimeout(r, WARMUP_MS + LOAD_MS));
stop = true;
clearInterval(sampler);

// Wait for workers with timeout
const drainStart = Date.now();
const drainTimeout = setTimeout(() => {
  console.log(`[soak] WARNING: worker drain exceeded 30s`);
}, 30_000);
await Promise.race([
  Promise.all(workerPromises),
  new Promise(r => setTimeout(r, 30_000)),
]);
clearTimeout(drainTimeout);
console.log(`[soak] worker drain took ${Date.now() - drainStart}ms`);
snap('after-stop');

await new Promise(r => setTimeout(r, 30_000));
snap('drain-30s');

for (let i = 0; i < 3; i++) {
  (Bun as BunWithGc).gc(true);
  await new Promise(r => setTimeout(r, 30_000));
  snap(`post-gc-${i+1}`);
}

// Report
const findPhase = (p: string) => samples.find(s => s.phase === p);
const first = samples[0]; const last = samples[samples.length - 1];
const afterStop = findPhase('after-stop') ?? last;
console.log('\n═══ SOAK REPORT ═══');
console.log(`wall-time: ${((last.t - first.t) / 60000).toFixed(1)} min`);
console.log(`requests-completed: ${completed}`);
console.log(`errors: ${errors}`);
console.log(`concurrency: ${CONCURRENCY}`);
console.log(`RSS(MB):     start=${(first.mu.rss/1048576).toFixed(1)}  after-stop=${(afterStop.mu.rss/1048576).toFixed(1)}  final=${(last.mu.rss/1048576).toFixed(1)}`);
console.log(`heapUsed:    start=${(first.mu.heapUsed/1048576).toFixed(1)}  after-stop=${(afterStop.mu.heapUsed/1048576).toFixed(1)}  final=${(last.mu.heapUsed/1048576).toFixed(1)}`);
console.log(`external:    start=${(first.mu.external/1048576).toFixed(1)}  final=${(last.mu.external/1048576).toFixed(1)}`);
console.log(`arrayBuf:    start=${(first.mu.arrayBuffers/1048576).toFixed(1)}  final=${(last.mu.arrayBuffers/1048576).toFixed(1)}`);
console.log(`handles:     start=${first.handles}  final=${last.handles}`);
console.log(`error-types: ${JSON.stringify([...errorTypes.entries()])}`);
console.log('\nfull samples:');
for (const s of samples) {
  console.log(`  ${s.phase.padEnd(14)} rss=${(s.mu.rss/1048576).toFixed(1)}M heap=${(s.mu.heapUsed/1048576).toFixed(1)}M ext=${(s.mu.external/1048576).toFixed(1)}M ab=${(s.mu.arrayBuffers/1048576).toFixed(1)}M h=${s.handles} m=${JSON.stringify(s.metrics)} done=${s.completed} err=${s.errors}`);
}

server.stop();
process.exit(0);
