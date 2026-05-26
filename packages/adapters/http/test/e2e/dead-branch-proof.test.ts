/**
 * 모든 미지원 메서드(TRACE/CONNECT/LINK 등)가 resolveRoute 를 통과해
 * 404/405 로 일관 처리되는지 검증 — 501 fast path 폐기 후 동작.
 *
 * - TRACE /any-path → resolveRoute 호출 → not-found → 404
 * - CONNECT path-form → 동일
 * - CONNECT authority-form → parseRequestTarget 실패 → 400 (resolveRoute 도달 안 함)
 * - LINK /whatever → resolveRoute 호출 → 404
 * - 등록 path 에 다른 메서드 → 405 + Allow
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test';
import type { ZipbulContainer, CompiledHandlerEntry } from '@zipbul/common';

import { loggerMockModule } from '@zipbul/logger/testing';

mock.module('@zipbul/logger', loggerMockModule());

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

describe('Unknown methods route through resolveRoute → 404/405 (501 fast path removed)', () => {
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
    const controllerFactories = new Map<string, () => unknown>([['TestController', () => ctrl]]);

    server = new HttpServer();
    await server.boot(createMockContainer(), {
      port: PORT,
      bodyLimit: 1024,
      metadata: metadata as never,
      handlerIndex,
      controllerFactories,
    } as never, adapter);
  });

  afterAll(() => {
    server.stop();
  });

  it('TRACE /any-path → 404 via resolveRoute not-found', async () => {
    resolveRouteSpy.mockClear();
    const { status } = await rawTcp(`TRACE /any-path HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);

    expect(status).toBe(404);
    expect(resolveRouteSpy).toHaveBeenCalledTimes(1);
  });

  it('CONNECT /proxy-target (path-form) → 404 via resolveRoute not-found', async () => {
    resolveRouteSpy.mockClear();
    const { status } = await rawTcp(`CONNECT /proxy-target HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);

    expect(status).toBe(404);
    expect(resolveRouteSpy).toHaveBeenCalledTimes(1);
  });

  it('CONNECT authority-form → 400 via parseRequestTarget failure (no resolveRoute)', async () => {
    resolveRouteSpy.mockClear();
    const { status } = await rawTcp(`CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\nConnection: close\r\n\r\n`);

    // authority-form fails parseRequestTarget → bad-request (invalid-url) → 400 (early exit before resolveRoute)
    expect(status).toBe(400);
    expect(resolveRouteSpy).not.toHaveBeenCalled();
  });

  it('LINK /whatever (unknown method, unregistered path) → 404 via resolveRoute', async () => {
    resolveRouteSpy.mockClear();
    const resp = await fetch(`${BASE}/whatever`, { method: 'LINK' });

    expect(resp.status).toBe(404);
    expect(resolveRouteSpy).toHaveBeenCalledTimes(1);
  });

  it('LINK /registered (unknown method, registered path) → 405 + Allow', async () => {
    resolveRouteSpy.mockClear();
    const resp = await fetch(`${BASE}/registered`, { method: 'LINK' });

    expect(resp.status).toBe(405);
    expect(resp.headers.get('allow')).toContain('GET');
    expect(resolveRouteSpy).toHaveBeenCalledTimes(1);
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
