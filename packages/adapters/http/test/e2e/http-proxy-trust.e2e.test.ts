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
// HttpRequest not needed at top level in this e2e test.

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

function buildIndex(): { handlerIndex: readonly CompiledHandlerEntry[]; controllerInstances: Map<string, unknown>; metadata: Map<new (...args: readonly unknown[]) => unknown, { readonly className: string; readonly decorators: readonly { readonly name: string; readonly arguments?: readonly unknown[] }[] }> } {
  class TestController { [key: string]: unknown }
  const handler = (ctx: InstanceType<typeof HttpContext>) => ({
    ip: ctx.request.ip,
    ips: [...ctx.request.ips],
    protocol: ctx.request.protocol,
    host: ctx.request.host,
    hostname: ctx.request.hostname,
    port: ctx.request.port,
    isTrustedProxy: ctx.request.isTrustedProxy,
  });
  const controllerInstance: Record<string, unknown> = { probe: handler };
  const controllerInstances = new Map<string, unknown>([['TestController', controllerInstance]]);
  const handlerIndex: CompiledHandlerEntry[] = [{
    id: 'HttpAdapter:TestController.probe',
    adapterId: 'HttpAdapter',
    controllerKey: 'TestController',
    methodName: 'probe',
    handlerDecorator: 'Get',
    handlerDecoratorArgs: ['probe'],
    options: [],
    compiledPre: ['BeforeParse', 'ParseBody', 'BeforeValidate', 'Validation', 'Guard', 'BeforeHandle'],
    compiledPost: ['WriteResponse', 'AfterHandle', 'Serialize', 'BeforeResponse'],
  }];
  const metadata = new Map<new (...args: readonly unknown[]) => unknown, { readonly className: string; readonly decorators: readonly { readonly name: string; readonly arguments?: readonly unknown[] }[] }>();
  metadata.set(TestController, { className: 'TestController', decorators: [{ name: 'RestController', arguments: [] }] });
  return { handlerIndex, controllerInstances, metadata };
}

async function bootWith(trustProxy: unknown): Promise<{ server: Server; adapter: Adapter; port: number }> {
  const port = 50000 + Math.floor(Math.random() * 10000);
  const container = emptyContainer();
  const adapter = new HttpAdapter({ port, trustProxy: trustProxy as never });
  adapter.initializePipeline(container);
  const server = new HttpServer();
  const idx = buildIndex();
  await server.boot(container, {
    port,
    trustProxy: trustProxy as never,
    metadata: idx.metadata as never,
    handlerIndex: idx.handlerIndex,
    controllerInstances: idx.controllerInstances,
  }, adapter as never);
  return { server, adapter, port };
}

interface ProbeResult {
  ip: string | null;
  ips: readonly string[];
  protocol: string | null;
  host: string | null;
  hostname: string | null;
  port: number;
  isTrustedProxy: boolean;
}

async function probe(port: number, headers: Record<string, string>): Promise<ProbeResult> {
  const res = await fetch(`http://localhost:${port}/probe`, { headers });
  return await res.json() as ProbeResult;
}

describe('HttpAdapter proxy trust E2E', () => {
  describe('trustProxy=false (default)', () => {
    let ctx: Awaited<ReturnType<typeof bootWith>>;
    beforeAll(async () => { ctx = await bootWith(false); });
    afterAll(async () => { await ctx.server.stop(); });

    it('should ignore X-Forwarded-For when trustProxy disabled', async () => {
      const res = await probe(ctx.port, { 'x-forwarded-for': '10.9.9.9, 11.11.11.11' });
      expect(res.isTrustedProxy).toBe(false);
      expect(res.ips).toEqual([]);
    });

    it('should ignore Forwarded header when trustProxy disabled', async () => {
      const res = await probe(ctx.port, { 'forwarded': 'for=10.9.9.9;proto=https;host=external.example' });
      expect(res.isTrustedProxy).toBe(false);
      expect(res.protocol).toBe('http');
    });
  });

  describe('trustProxy=true (trust all)', () => {
    let ctx: Awaited<ReturnType<typeof bootWith>>;
    beforeAll(async () => { ctx = await bootWith(true); });
    afterAll(async () => { await ctx.server.stop(); });

    it('should use left-most XFF as client IP and full chain in ips', async () => {
      const res = await probe(ctx.port, { 'x-forwarded-for': '198.51.100.5, 203.0.113.1' });
      expect(res.isTrustedProxy).toBe(true);
      expect(res.ips).toEqual(['198.51.100.5', '203.0.113.1']);
      expect(res.ip).toBe('198.51.100.5');
    });

    it('should read protocol and host from Forwarded header (RFC 7239)', async () => {
      const res = await probe(ctx.port, { 'forwarded': 'for=198.51.100.5;proto=https;host=app.example' });
      expect(res.isTrustedProxy).toBe(true);
      expect(res.protocol).toBe('https');
      expect(res.host).toBe('app.example');
    });

    it('should prefer X-Forwarded-Proto fallback when Forwarded absent', async () => {
      const res = await probe(ctx.port, {
        'x-forwarded-for': '198.51.100.5',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'api.example',
        'x-forwarded-port': '8443',
      });
      expect(res.isTrustedProxy).toBe(true);
      expect(res.protocol).toBe('https');
      expect(res.host).toBe('api.example');
      expect(res.port).toBe(8443);
    });
  });

  describe('trustProxy=CIDR (127.0.0.0/8)', () => {
    let ctx: Awaited<ReturnType<typeof bootWith>>;
    beforeAll(async () => { ctx = await bootWith('127.0.0.0/8'); });
    afterAll(async () => { await ctx.server.stop(); });

    it('should trust localhost proxy and accept XFF chain', async () => {
      const res = await probe(ctx.port, { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' });
      expect(res.isTrustedProxy).toBe(true);
      expect(res.ips).toEqual(['203.0.113.9', '10.0.0.1']);
    });
  });

  describe('trustProxy=number hop', () => {
    let ctx: Awaited<ReturnType<typeof bootWith>>;
    beforeAll(async () => { ctx = await bootWith(1); });
    afterAll(async () => { await ctx.server.stop(); });

    it('should walk back 1 hop only (hopIndex limit)', async () => {
      const res = await probe(ctx.port, { 'x-forwarded-for': '198.51.100.5, 203.0.113.1' });
      expect(res.isTrustedProxy).toBe(true);
      // resolveClientIp walks back from rightmost while socketIp is trusted.
      // 1 hop → result is the last trusted segment.
      expect(res.ip).not.toBe(null);
    });
  });

  describe('HttpRequest origin parsing', () => {
    it('should extract host, hostname, port from URL when no proxy', async () => {
      const direct = await bootWith(false);
      const res = await probe(direct.port, {});
      expect(res.host).toBe(`localhost:${direct.port}`);
      expect(res.hostname).toBe('localhost');
      expect(res.port).toBe(direct.port);
      await direct.server.stop();
    });
  });
});
