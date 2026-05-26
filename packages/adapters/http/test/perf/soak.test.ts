/**
 * Leak/soak test for the zipbul Bun HTTP adapter.
 * Runs via `bun test --timeout 0` from inside packages/http-adapter.
 */
import { describe, it, mock } from 'bun:test';
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
const { HttpContext } = await import(`${HTTP_SRC}/http-context`);
const { ServerSentEvent } = await import(`${HTTP_SRC}/server-sent-event`);
const { httpError } = await import(`${HTTP_SRC}/http-error`);

const PORT = 51337;
const BASE = `http://127.0.0.1:${PORT}`;

function mkContainer(): ZipbulContainer {
  return { get: () => undefined, set: () => {}, has: () => false, getInstances: function*(){}, keys: function*(){} } as unknown as ZipbulContainer;
}
class SoakController { [k: string]: unknown; }

type Route = { method: string; path: string; name: string; handler: (c: InstanceType<typeof HttpContext>) => unknown; options?: ReadonlyArray<{ name: string; arguments?: readonly unknown[] }> };

function build(routes: Route[]) {
  const inst: Record<string, unknown> = {};
  for (const r of routes) inst[r.name] = r.handler;
  const controllerFactories = new Map<string, () => unknown>([['SoakController', () => inst]]);
  const handlerIndex: CompiledHandlerEntry[] = routes.map(r => {
    const base = {
      id: `HttpAdapter:SoakController.${r.name}`,
      adapterId: 'HttpAdapter',
      controllerKey: 'SoakController',
      methodName: r.name,
      handlerDecorator: r.method,
      handlerDecoratorArgs: [r.path] as readonly unknown[],
      compiledPre: ['BeforeParse','ParseBody','BeforeValidate','Validation','Guard','BeforeHandle'] as readonly string[],
      compiledPost: ['WriteResponse','AfterHandle','Serialize','BeforeResponse'] as readonly string[],
    };
    if (r.options !== undefined) {
      return { ...base, options: r.options as NonNullable<CompiledHandlerEntry['options']> };
    }
    return base;
  });
  const metadata = new Map();
  metadata.set(SoakController, { className: 'SoakController', decorators: [{ name: 'RestController', arguments: [] }] });
  return { handlerIndex, controllerFactories, metadata };
}

const BIGBODY = new Uint8Array(256 * 1024);
for (let i = 0; i < BIGBODY.length; i++) BIGBODY[i] = i & 0xff;

const routes: Route[] = [
  { method: 'Get', path: 'ping', name: 'ping', handler: () => ({ ok: 1 }) },
  { method: 'Post', path: 'echo', name: 'echo', handler: (c) => c.request.body },
  { method: 'Get', path: 'stream', name: 'stream', handler: () => {
      async function* g() { for (let i = 0; i < 100; i++) yield `chunk-${i}\n`; }
      return g();
    }, options: [{ name: 'ContentType', arguments: ['text/plain'] }] },
  { method: 'Get', path: 'sse', name: 'sse', handler: () => {
      async function* g() { for (let i = 0; i < 100; i++) yield new ServerSentEvent({ n: i }, { event: 'tick' }); }
      return g();
    }, options: [{ name: 'Sse' }] },
  { method: 'Get', path: 'throw', name: 'thrower', handler: () => httpError(500, 'boom') },
  { method: 'Get', path: 'bigbody', name: 'big', handler: (c) => { c.response.setHeader('content-type', 'application/octet-stream'); return BIGBODY; } },
];

describe('http-adapter soak', () => {
  it('soak', async () => {
    const adapter = new HttpAdapter({ port: PORT, bodyLimit: 1024 * 1024 });
    const container = mkContainer();
    adapter.initializePipeline(container);
    const built = build(routes);
    const server = new HttpServer();
    await server.boot(container, {
      port: PORT, bodyLimit: 1024 * 1024,
      metadata: built.metadata as never,
      handlerIndex: built.handlerIndex,
      controllerFactories: built.controllerFactories,
    } as never, adapter as never);

    // ── Verify endpoints once ──
    const verify = async () => {
      const r1 = await fetch(`${BASE}/ping`); if (r1.status !== 200) throw new Error('ping ' + r1.status);
      await r1.arrayBuffer();
      const r2 = await fetch(`${BASE}/echo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ x: 1 }) });
      if (r2.status !== 200) throw new Error('echo ' + r2.status); await r2.arrayBuffer();
      const r3 = await fetch(`${BASE}/stream`); await r3.arrayBuffer(); if (r3.status !== 200) throw new Error('stream');
      const r4 = await fetch(`${BASE}/sse`); await r4.arrayBuffer(); if (r4.status !== 200) throw new Error('sse');
      const r5 = await fetch(`${BASE}/throw`); await r5.arrayBuffer(); if (r5.status !== 500) throw new Error('throw '+r5.status);
      const r6 = await fetch(`${BASE}/bigbody`); const b = await r6.arrayBuffer(); if (r6.status !== 200 || b.byteLength !== BIGBODY.length) throw new Error('big');
      return true;
    };
    await verify();
    console.log('[soak] endpoints verified');

    // ── Stats ──
    let errors = 0; const errorTypes = new Map<string, number>();
    let completed = 0;
    const samples: Array<{ t: number; phase: string; mu: NodeJS.MemoryUsage; handles: number; reqs: number; metrics: unknown }> = [];

    process.on('unhandledRejection', (r) => { errors++; errorTypes.set('unhandledRejection:' + String(r).slice(0,60), (errorTypes.get('unhandledRejection:'+String(r).slice(0,60))??0)+1); });
    process.on('uncaughtException', (e) => { errors++; errorTypes.set('uncaughtException:' + e.message.slice(0,60), (errorTypes.get('uncaughtException:'+e.message.slice(0,60))??0)+1); });

    const snap = (phase: string) => {
      const mu = process.memoryUsage();
      const proc = process as ProcessInternals;
      const h = proc._getActiveHandles?.().length ?? -1;
      const q = proc._getActiveRequests?.().length ?? -1;
      const m = server.getMetrics?.();
      samples.push({ t: Date.now(), phase, mu, handles: h, reqs: q, metrics: m });
      console.log(`[${phase}] rss=${(mu.rss/1048576).toFixed(1)}M heap=${(mu.heapUsed/1048576).toFixed(1)}M ext=${(mu.external/1048576).toFixed(1)}M ab=${(mu.arrayBuffers/1048576).toFixed(1)}M handles=${h} reqs=${q} metrics=${JSON.stringify(m)} completed=${completed} errors=${errors}`);
    };

    const endpoints = [
      async () => fetch(`${BASE}/ping`),
      async () => fetch(`${BASE}/echo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1,"b":"x"}' }),
      async () => fetch(`${BASE}/stream`),
      async () => fetch(`${BASE}/sse`),
      async () => fetch(`${BASE}/throw`),
      async () => fetch(`${BASE}/bigbody`),
    ];

    let stop = false;
    const worker = async (id: number) => {
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
    };

    snap('baseline');
    // ── Warm-up 30s ──
    const WARMUP_MS = 5_000;
    const LOAD_MS = 20_000;
    const SAMPLE_MS = 30_000;
    const CONCURRENCY = 100;

    const sampler = setInterval(() => snap('load'), SAMPLE_MS);

    const workers = Array.from({ length: CONCURRENCY }, (_, i) => worker(i));
    await new Promise(r => setTimeout(r, WARMUP_MS));
    snap('after-warmup');

    await new Promise(r => setTimeout(r, LOAD_MS));
    stop = true;
    clearInterval(sampler);
    await Promise.all(workers);
    snap('after-stop');

    // Drain 30s
    await new Promise(r => setTimeout(r, 5_000));
    snap('drain-30s');

    // 3 cycles of GC + wait
    for (let i = 0; i < 3; i++) {
      (Bun as BunWithGc).gc(true);
      await new Promise(r => setTimeout(r, 5_000));
      snap(`post-gc-${i+1}`);
    }

    // Report
    const first = samples[0]!; const last = samples[samples.length - 1]!;
    console.log('--- SOAK REPORT ---');
    console.log(`samples: ${samples.length}`);
    console.log(`completed: ${completed}  errors: ${errors}`);
    console.log(`rss: start=${(first.mu.rss/1048576).toFixed(1)}M  end=${(samples.find(s=>s.phase==='after-stop')!.mu.rss/1048576).toFixed(1)}M  post-gc=${(last.mu.rss/1048576).toFixed(1)}M`);
    console.log(`heapUsed: start=${(first.mu.heapUsed/1048576).toFixed(1)}M  end=${(samples.find(s=>s.phase==='after-stop')!.mu.heapUsed/1048576).toFixed(1)}M  post-gc=${(last.mu.heapUsed/1048576).toFixed(1)}M`);
    console.log(`external: start=${(first.mu.external/1048576).toFixed(1)}M  post-gc=${(last.mu.external/1048576).toFixed(1)}M`);
    console.log(`arrayBuffers: start=${(first.mu.arrayBuffers/1048576).toFixed(1)}M  post-gc=${(last.mu.arrayBuffers/1048576).toFixed(1)}M`);
    console.log(`handles: start=${first.handles}  post-gc=${last.handles}`);
    console.log(`error types: ${JSON.stringify([...errorTypes.entries()])}`);
    console.log(`samples JSON: ${JSON.stringify(samples.map(s=>({p:s.phase, t:s.t, rss:s.mu.rss, heap:s.mu.heapUsed, ext:s.mu.external, ab:s.mu.arrayBuffers, h:s.handles, m:s.metrics})))}`);

    server.stop();
  }, 30 * 60_000);
});
