/**
 * 증명 — 삭제된 TRACE/CONNECT 분기가 production 에서 도달 불가능함을 런타임 검증.
 *
 * 가설:
 *   (A) TRACE/CONNECT 요청은 pipelineError 경로로만 501 반환됨
 *       (resolveRoute 의 not-found 분기 도달 안 함)
 *   (B) 정상 메서드 + 미등록 path 는 resolveRoute → not-found 분기 도달 → 404
 *   (C) 미지원 메서드(LINK 등) 도 동일 — pipelineError 경로
 *
 * 방법: resolveRoute 를 spy 로 wrapping, 호출 여부 + matchResult 관찰.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test';
import type { ZipbulContainer, CompiledHandlerEntry } from '@zipbul/common';

mock.module('@zipbul/logger', () => ({
  Logger: class {
    static inherit() {
      return { debug() {}, info() {}, warn() {}, error() {} };
    }
    static runScoped(_logger: unknown, fn: () => unknown) { return fn(); }
    constructor() {
      return { debug() {}, info() {}, warn() {}, error() {} } as never;
    }
  },
}));

const { HttpAdapter } = await import('../../src/http-adapter');
type HttpAdapter = InstanceType<typeof HttpAdapter>;
const { HttpServer } = await import('../../src/http-server');
type HttpServer = InstanceType<typeof HttpServer>;

const PORT = 7821;
const BASE = `http://127.0.0.1:${PORT}`;

let adapter: HttpAdapter;
let server: HttpServer;
let resolveRouteSpy: ReturnType<typeof mock>;

function createMockContainer(): ZipbulContainer {
  return {
    get: () => undefined,
    set: () => {},
    has: () => false,
    getInstances: function* () {},
    keys: function* () {},
  } as unknown as ZipbulContainer;
}

async function rawTcp(req: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    let data = '';
    Bun.connect({
      hostname: '127.0.0.1',
      port: PORT,
      socket: {
        open(s) { s.write(req); },
        data(_s, chunk) { data += chunk.toString(); },
        close() {
          const status = parseInt(data.match(/HTTP\/1\.1 (\d+)/)?.[1] ?? '0', 10);
          const body = data.split('\r\n\r\n')[1] ?? '';
          resolve({ status, body });
        },
        error(_s, e) { reject(e); },
      },
    });
    setTimeout(() => reject(new Error('timeout')), 2000);
  });
}

describe('Dead branch proof — TRACE/CONNECT cannot reach resolveRoute', () => {
  beforeAll(async () => {
    adapter = new HttpAdapter({ port: PORT, bodyLimit: 1024 });

    // resolveRoute 를 spy 로 감싼다 (호출 추적용)
    const target = adapter as unknown as { resolveRoute: (...args: unknown[]) => unknown };
    const original = target.resolveRoute.bind(adapter);
    resolveRouteSpy = mock((...args: unknown[]) => original(...args));
    target.resolveRoute = resolveRouteSpy as never;

    // GET /registered 라우트 1개 등록 — 405/OPTIONS 분기 도달 증명용
    class TestController { [k: string]: unknown }
    const ctrl = new TestController();
    (ctrl as unknown as Record<string, unknown>)['handle'] = () => ({ ok: true });
    const metadata = new Map();
    metadata.set(TestController, {
      className: 'TestController',
      decorators: [{ name: 'RestController', arguments: [] }],
    });
    const handlerIndex: CompiledHandlerEntry[] = [{
      id: 'HttpAdapter:test#TestController.handle',
      adapterId: 'HttpAdapter',
      controllerKey: 'TestController',
      methodName: 'handle',
      handlerDecorator: 'Get',
      handlerDecoratorArgs: ['registered'],
      params: [],
    } as never];
    const controllerInstances = new Map<string, unknown>([['TestController', ctrl]]);

    server = new HttpServer();
    await server.boot(createMockContainer(), {
      port: PORT,
      bodyLimit: 1024,
      metadata: metadata as never,
      handlerIndex,
      controllerInstances,
    } as never, adapter);
  });

  afterAll(() => {
    server.stop();
  });

  it('(A) TRACE raw TCP → 501 WITHOUT calling resolveRoute', async () => {
    resolveRouteSpy.mockClear();
    const { status } = await rawTcp(`TRACE /any-path HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);

    expect(status).toBe(501);
    expect(resolveRouteSpy).not.toHaveBeenCalled();
  });

  it('(A) CONNECT path-form raw TCP → 501 WITHOUT calling resolveRoute', async () => {
    // Note: RFC 9112 §3.2.3 mandates authority-form for CONNECT, but Bun accepts
    // path-form too. authority-form (host:port) fails parseRequestTarget → 400
    // (also without resolveRoute). Either path proves the dead branch is unreachable.
    resolveRouteSpy.mockClear();
    const { status } = await rawTcp(`CONNECT /proxy-target HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);

    expect(status).toBe(501);
    expect(resolveRouteSpy).not.toHaveBeenCalled();
  });

  it('(A) CONNECT authority-form raw TCP → 400 WITHOUT calling resolveRoute', async () => {
    resolveRouteSpy.mockClear();
    const { status } = await rawTcp(`CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\nConnection: close\r\n\r\n`);

    // authority-form fails parseRequestTarget → bad-request (invalid-url) → 400
    expect(status).toBe(400);
    expect(resolveRouteSpy).not.toHaveBeenCalled();
  });

  it('(C) LINK (unknown method) → 501 WITHOUT calling resolveRoute', async () => {
    resolveRouteSpy.mockClear();
    const resp = await fetch(`${BASE}/whatever`, { method: 'LINK' });

    expect(resp.status).toBe(501);
    expect(resolveRouteSpy).not.toHaveBeenCalled();
  });

  it('(B) GET /unknown-path → 404 via resolveRoute not-found (alive branch)', async () => {
    resolveRouteSpy.mockClear();
    const resp = await fetch(`${BASE}/this-does-not-exist`);

    expect(resp.status).toBe(404);
    expect(resolveRouteSpy).toHaveBeenCalledTimes(1);
  });

  it('(B) GET /registered → resolveRoute matched (alive branch, status not 404)', async () => {
    // 핸들러 응답 내용은 buildRoutePipeline 미설정 상태라 204 일 수 있음.
    // 핵심은 matched 분기 진입(=resolveRoute 호출 + 404 아님) 증명.
    resolveRouteSpy.mockClear();
    const resp = await fetch(`${BASE}/registered`);

    expect(resp.status).not.toBe(404);
    expect(resolveRouteSpy).toHaveBeenCalledTimes(1);
  });

  it('(B) POST /registered → 405 + Allow via resolveRoute method-not-allowed (alive branch)', async () => {
    resolveRouteSpy.mockClear();
    const resp = await fetch(`${BASE}/registered`, { method: 'POST' });

    expect(resp.status).toBe(405);
    expect(resp.headers.get('allow')).toContain('GET');
    expect(resolveRouteSpy).toHaveBeenCalledTimes(1);
  });

  it('(B) OPTIONS /registered → 204 + Allow via resolveRoute OPTIONS auto-response (alive branch)', async () => {
    resolveRouteSpy.mockClear();
    const resp = await fetch(`${BASE}/registered`, { method: 'OPTIONS' });

    expect(resp.status).toBe(204);
    expect(resp.headers.get('allow')).toContain('GET');
    expect(resolveRouteSpy).toHaveBeenCalledTimes(1);
  });
});
