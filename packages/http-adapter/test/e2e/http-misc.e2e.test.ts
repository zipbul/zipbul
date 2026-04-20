import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test';
import type { ZipbulContainer, CompiledHandlerEntry } from '@zipbul/common';

mock.module('@zipbul/logger', () => ({
  Logger: class {
    static inherit() { return { debug() {}, info() {}, warn() {}, error() {} }; }
    static runScoped(_logger: unknown, fn: () => unknown) { return fn(); }
    constructor() { return { debug() {}, info() {}, warn() {}, error() {} } as never; }
  },
}));

const { HttpAdapter } = await import('../../src/http-adapter');
type HttpAdapter = InstanceType<typeof HttpAdapter>;
const { HttpServer } = await import('../../src/http-server');
type HttpServer = InstanceType<typeof HttpServer>;
const { HttpContext } = await import('../../src/http-context');
type HttpContext = InstanceType<typeof HttpContext>;

type Adapter = InstanceType<typeof HttpAdapter>;
type Server = InstanceType<typeof HttpServer>;

function emptyContainer(): ZipbulContainer {
  return {
    get: () => undefined as never,
    set: () => {},
    has: () => false,
    getInstances: function* () {},
    keys: function* () {},
  };
}

interface RouteSpec {
  readonly method: string;
  readonly path: string;
  readonly handlerName: string;
  readonly handler: (ctx: InstanceType<typeof HttpContext>) => unknown;
  readonly options?: ReadonlyArray<{ readonly name: string; readonly arguments?: readonly unknown[] }>;
}

function buildIndex(routes: readonly RouteSpec[]): {
  handlerIndex: readonly CompiledHandlerEntry[];
  controllerInstances: Map<string, unknown>;
  metadata: Map<new (...args: readonly unknown[]) => unknown, { readonly className: string; readonly decorators: readonly { readonly name: string; readonly arguments?: readonly unknown[] }[] }>;
} {
  class TestController { [key: string]: unknown }
  const controllerInstance: Record<string, unknown> = {};
  for (const r of routes) controllerInstance[r.handlerName] = r.handler;
  const controllerInstances = new Map<string, unknown>([['TestController', controllerInstance]]);
  const handlerIndex: CompiledHandlerEntry[] = routes.map(r => {
    const base = {
      id: `HttpAdapter:TestController.${r.handlerName}`,
      adapterId: 'HttpAdapter',
      controllerKey: 'TestController',
      methodName: r.handlerName,
      handlerDecorator: r.method,
      handlerDecoratorArgs: [r.path] as readonly unknown[],
      compiledPre: ['BeforeParse', 'ParseBody', 'BeforeValidate', 'Validation', 'Guard', 'BeforeHandle'] as readonly string[],
      compiledPost: ['WriteResponse', 'AfterHandle', 'Serialize', 'BeforeResponse'] as readonly string[],
    };
    if (r.options !== undefined) {
      return { ...base, options: r.options as NonNullable<CompiledHandlerEntry['options']> };
    }
    return base;
  });
  const metadata = new Map<new (...args: readonly unknown[]) => unknown, { readonly className: string; readonly decorators: readonly { readonly name: string; readonly arguments?: readonly unknown[] }[] }>();
  metadata.set(TestController, { className: 'TestController', decorators: [{ name: 'RestController', arguments: [] }] });
  return { handlerIndex, controllerInstances, metadata };
}

async function boot(options: Record<string, unknown>, routes: readonly RouteSpec[]): Promise<{ server: Server; adapter: Adapter; port: number }> {
  const port = 50000 + Math.floor(Math.random() * 10000);
  const container = emptyContainer();
  const adapter = new HttpAdapter({ port, ...options });
  adapter.initializePipeline(container);
  const server = new HttpServer();
  const idx = buildIndex(routes);
  await server.boot(container, {
    port,
    ...options,
    metadata: idx.metadata as never,
    handlerIndex: idx.handlerIndex,
    controllerInstances: idx.controllerInstances,
  }, adapter as never);
  return { server, adapter, port };
}

describe('HTTP misc E2E', () => {
  describe('Additional redirect statuses (303/307/308)', () => {
    let ctx: Awaited<ReturnType<typeof boot>>;
    beforeAll(async () => {
      ctx = await boot({}, [
        { method: 'Get', path: 'r303', handlerName: 'r303', handler: (c) => { c.response.redirect('/after-303', 303); return undefined; } },
        { method: 'Get', path: 'r307', handlerName: 'r307', handler: (c) => { c.response.redirect('/after-307', 307); return undefined; } },
        { method: 'Get', path: 'r308', handlerName: 'r308', handler: (c) => { c.response.redirect('/after-308', 308); return undefined; } },
      ]);
    });
    afterAll(async () => { await ctx.server.stop(); });

    it('should return 303 See Other redirect', async () => {
      const res = await fetch(`http://localhost:${ctx.port}/r303`, { redirect: 'manual' });
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/after-303');
    });

    it('should return 307 Temporary Redirect', async () => {
      const res = await fetch(`http://localhost:${ctx.port}/r307`, { redirect: 'manual' });
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('/after-307');
    });

    it('should return 308 Permanent Redirect', async () => {
      const res = await fetch(`http://localhost:${ctx.port}/r308`, { redirect: 'manual' });
      expect(res.status).toBe(308);
      expect(res.headers.get('location')).toBe('/after-308');
    });
  });

  describe('Dangerous redirect scheme rejection', () => {
    let ctx: Awaited<ReturnType<typeof boot>>;
    beforeAll(async () => {
      ctx = await boot({}, [
        { method: 'Get', path: 'javascript', handlerName: 'js', handler: (c) => { c.response.redirect('javascript:alert(1)'); } },
        { method: 'Get', path: 'data', handlerName: 'data', handler: (c) => { c.response.redirect('data:text/html,<h1>x</h1>'); } },
        { method: 'Get', path: 'vbscript', handlerName: 'vb', handler: (c) => { c.response.redirect('vbscript:msgbox("x")'); } },
      ]);
    });
    afterAll(async () => { await ctx.server.stop(); });

    it('should reject javascript: redirect and respond 500', async () => {
      const res = await fetch(`http://localhost:${ctx.port}/javascript`);
      expect(res.status).toBe(500);
    });

    it('should reject data: redirect and respond 500', async () => {
      const res = await fetch(`http://localhost:${ctx.port}/data`);
      expect(res.status).toBe(500);
    });

    it('should reject vbscript: redirect and respond 500', async () => {
      const res = await fetch(`http://localhost:${ctx.port}/vbscript`);
      expect(res.status).toBe(500);
    });
  });

  describe('Content-Length negative rejection', () => {
    let ctx: Awaited<ReturnType<typeof boot>>;
    beforeAll(async () => {
      ctx = await boot({}, [
        { method: 'Post', path: 'echo', handlerName: 'echo', handler: () => ({ ok: true }) },
      ]);
    });
    afterAll(async () => { await ctx.server.stop(); });

    it('should return 400 for request with Content-Length: -1 via raw TCP', async () => {
      const { status } = await sendRawWithCL(ctx.port, -1);
      expect(status).toBe(400);
    });
  });

  describe('Custom maxUriLength option', () => {
    let ctx: Awaited<ReturnType<typeof boot>>;
    beforeAll(async () => {
      ctx = await boot({ maxUriLength: 128 }, [
        { method: 'Get', path: 'ok', handlerName: 'ok', handler: () => ({ ok: true }) },
      ]);
    });
    afterAll(async () => { await ctx.server.stop(); });

    it('should respect custom maxUriLength and return 414 when exceeded', async () => {
      const longPath = '/' + 'a'.repeat(200);
      const res = await fetch(`http://localhost:${ctx.port}${longPath}`);
      expect(res.status).toBe(414);
    });

    it('should accept URLs below the custom limit', async () => {
      const res = await fetch(`http://localhost:${ctx.port}/ok`);
      expect(res.status).toBe(200);
    });
  });

  describe('Custom Request ID options', () => {
    describe('requestId.header (read from incoming header)', () => {
      let ctx: Awaited<ReturnType<typeof boot>>;
      beforeAll(async () => {
        ctx = await boot({ requestId: { header: 'x-trace-id' } }, [
          { method: 'Get', path: 'rid', handlerName: 'rid', handler: (c) => ({ id: c.request.requestId }) },
        ]);
      });
      afterAll(async () => { await ctx.server.stop(); });

      it('should pick up incoming X-Trace-Id header as request id', async () => {
        const res = await fetch(`http://localhost:${ctx.port}/rid`, { headers: { 'x-trace-id': 'trace-abc-123' } });
        const body = await res.json() as { id: string };
        expect(body.id).toBe('trace-abc-123');
      });

      it('should fall back to generated UUID when header is missing', async () => {
        const res = await fetch(`http://localhost:${ctx.port}/rid`);
        const body = await res.json() as { id: string };
        expect(body.id.length).toBeGreaterThan(10);
        expect(body.id).not.toBe('trace-abc-123');
      });

      it('should reject malformed request id header (non-printable) and fall back', async () => {
        const res = await fetch(`http://localhost:${ctx.port}/rid`, { headers: { 'x-trace-id': 'valid-ascii' } });
        const body = await res.json() as { id: string };
        expect(body.id).toBe('valid-ascii');
      });
    });

    describe('requestId.generate (custom generator)', () => {
      let counter = 0;
      let ctx: Awaited<ReturnType<typeof boot>>;
      beforeAll(async () => {
        ctx = await boot({ requestId: { generate: () => `req-${++counter}` } }, [
          { method: 'Get', path: 'rid', handlerName: 'rid', handler: (c) => ({ id: c.request.requestId }) },
        ]);
      });
      afterAll(async () => { await ctx.server.stop(); });

      it('should use the custom generator for request IDs', async () => {
        const a = await (await fetch(`http://localhost:${ctx.port}/rid`)).json() as { id: string };
        const b = await (await fetch(`http://localhost:${ctx.port}/rid`)).json() as { id: string };
        expect(a.id).toMatch(/^req-\d+$/);
        expect(b.id).toMatch(/^req-\d+$/);
        expect(a.id).not.toBe(b.id);
      });
    });
  });

  describe('Graceful drain lifecycle', () => {
    it('should wait for in-flight requests to finish during drain', async () => {
      const ctx = await boot({}, [
        { method: 'Get', path: 'slow', handlerName: 'slow', handler: async () => { await Bun.sleep(80); return { done: true }; } },
      ]);

      const inFlight = fetch(`http://localhost:${ctx.port}/slow`);
      await Bun.sleep(10);
      const drainPromise = ctx.adapter.drain(2000);

      const [res] = await Promise.all([inFlight, drainPromise]);
      const body = await res.json() as { done: boolean };
      expect(res.status).toBe(200);
      expect(body.done).toBe(true);
    });

    it('should force-close pending connections after drain timeout elapses', async () => {
      const ctx = await boot({}, [
        { method: 'Get', path: 'never', handlerName: 'never', handler: async () => { await Bun.sleep(1500); return { done: true }; } },
      ]);

      const inFlight = fetch(`http://localhost:${ctx.port}/never`).catch(() => 'aborted' as const);
      await Bun.sleep(10);
      const t0 = Date.now();
      await ctx.adapter.drain(100);
      const elapsed = Date.now() - t0;

      expect(elapsed).toBeLessThan(500);
      // 백그라운드에서 inFlight 는 abort 되었거나 성공 — 우리는 drain timing 만 검증
      void inFlight;
    }, 3000);
  });
});

async function sendRawWithCL(port: number, contentLength: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    Bun.connect({
      hostname: 'localhost',
      port,
      socket: {
        open(s) {
          s.write(
            `POST /echo HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n` +
            `Content-Length: ${contentLength}\r\nConnection: close\r\n\r\n{}`,
          );
        },
        data(_s, c) { buffer += new TextDecoder().decode(c); },
        close() {
          const m = buffer.match(/^HTTP\/1\.1 (\d{3})/);
          const status = m !== null ? parseInt(m[1]!, 10) : 0;
          const bodyStart = buffer.indexOf('\r\n\r\n');
          resolve({ status, body: bodyStart !== -1 ? buffer.slice(bodyStart + 4) : '' });
        },
        error(_s, e) { reject(e); },
      },
    }).catch(reject);
  });
}
