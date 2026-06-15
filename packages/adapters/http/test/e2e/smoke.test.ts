import { describe, it, mock, expect } from 'bun:test';
import { join } from 'node:path';
import type { ZipbulContainer, CompiledHandlerEntry } from '@zipbul/common';

import { loggerMockModule } from '@zipbul/logger/testing';

mock.module('@zipbul/logger', loggerMockModule());
const realCore = await import('@zipbul/core');
mock.module('@zipbul/core', () => ({
  ...realCore,
  ClusterManager: class {},
  getBootstrapState: () => ({ isAotRuntime: false, metadataRegistry: new Map() }),
}));

const HTTP_SRC = join(import.meta.dir, '../../src');
const { HttpAdapter } = await import(`${HTTP_SRC}/http-adapter`);
const { HttpServer } = await import(`${HTTP_SRC}/http-server`);
// HttpContext not needed; controllers use raw handlers.
const { ServerSentEvent } = await import(`${HTTP_SRC}/server-sent-event`);
const { httpError } = await import(`${HTTP_SRC}/http-error`);

const PORT = 51338;
const BASE = `http://127.0.0.1:${PORT}`;

class SoakController { [k: string]: unknown; }

describe('soak smoke', () => {
  it('boots and serves all endpoints', async () => {
    const inst: Record<string, unknown> = {
      ping: () => ({ ok: 1 }),
      echo: (c: any) => c.request.body,
      stream: () => { async function* g() { for (let i = 0; i < 3; i++) yield `c${i}\n`; } return g(); },
      sse: () => { async function* g() { for (let i = 0; i < 3; i++) yield new ServerSentEvent({ n: i }, { event: 't' }); } return g(); },
      thrower: () => httpError(500, 'boom'),
      big: (c: any) => { c.response.setHeader('content-type', 'application/octet-stream'); return new Uint8Array(256*1024); },
    };
    const controllerFactories = new Map<string, () => unknown>([['SoakController', () => inst]]);
    const defs = [
      ['Get','ping','ping'], ['Post','echo','echo'], ['Get','stream','stream'],
      ['Get','sse','sse'], ['Get','throw','thrower'], ['Get','bigbody','big'],
    ] as const;
    const handlerIndex: CompiledHandlerEntry[] = defs.map(([m,p,n]) => ({
      id: `HttpAdapter:SoakController.${n}`, adapterId: 'HttpAdapter',
      controllerKey: 'SoakController', methodName: n,
      handlerDecorator: m, handlerDecoratorArgs: [p],
      options: n==='stream' ? [{ name: 'ContentType', arguments: ['text/plain'] }] as any
              : n==='sse' ? [{ name: 'Sse' }] as any : undefined,
      compiledPre: ['BeforeParse','ParseBody','BeforeValidate','Validation','Guard','BeforeHandle'],
      compiledPost: ['WriteResponse','AfterHandle','Serialize','BeforeResponse'],
    }));
    const metadata = new Map();
    metadata.set(SoakController, { className: 'SoakController', decorators: [{ name: 'RestController', arguments: [] }] });

    const adapter = new HttpAdapter({ port: PORT, bodyLimit: 1024 * 1024 });
    const container = { get: () => undefined, set: () => {}, has: () => false, getInstances: function*(){}, keys: function*(){} } as unknown as ZipbulContainer;
    adapter.initializePipeline(container);
    const server = new HttpServer();
    await server.boot(container, { port: PORT, bodyLimit: 1024*1024, metadata: metadata as never, handlerIndex, controllerFactories } as never, adapter as never);

    const r1 = await fetch(`${BASE}/ping`); expect(r1.status).toBe(200); expect(await r1.json()).toEqual({ ok: 1 });
    const r2 = await fetch(`${BASE}/echo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' }); expect(r2.status).toBe(200); expect(await r2.json()).toEqual({ a: 1 });
    const r3 = await fetch(`${BASE}/stream`); expect(r3.status).toBe(200); expect((await r3.text()).startsWith('c0')).toBe(true);
    const r4 = await fetch(`${BASE}/sse`); expect(r4.status).toBe(200); expect((await r4.text()).includes('event: t')).toBe(true);
    const r5 = await fetch(`${BASE}/throw`); expect(r5.status).toBe(500); await r5.arrayBuffer();
    const r6 = await fetch(`${BASE}/bigbody`); expect(r6.status).toBe(200); expect((await r6.arrayBuffer()).byteLength).toBe(256*1024);
    server.stop();
  }, 30_000);
});
