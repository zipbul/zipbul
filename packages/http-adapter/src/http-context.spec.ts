import { describe, it, expect, mock } from 'bun:test';

import { contextKey, type ZipbulContainer } from '@zipbul/common';
import { HttpContext } from './http-context';
import type { HttpRequest } from './http-request';
import type { HttpResponse } from './http-response';

function createStubRequest(): HttpRequest {
  return {
    requestId: 'stub-request-id',
    originalMethod: 'GET',
    originalUrl: 'http://localhost/test',
    method: 'GET',
    url: 'http://localhost/test',
    path: '/test',
    headers: new Headers(),
    protocol: 'http',
    host: 'localhost',
    hostname: 'localhost',
    port: 80,
    queryString: null,
    contentType: null,
    contentLength: null,
    ip: null,
    ips: [],
    isTrustedProxy: false,
    signal: AbortSignal.timeout(5000),
    body: undefined,
    params: {},
    rawBody: null,
  } as unknown as HttpRequest;
}

function createStubResponse(): HttpResponse {
  return {
    isSent: () => false,
    getStatus: () => 0,
    getBody: () => undefined,
  } as unknown as HttpResponse;
}

function createStubContainer(): ZipbulContainer {
  return {
    get: () => undefined as never,
    set: () => undefined,
    has: () => false,
    getInstances: function* () {},
    keys: function* () {},
  } satisfies ZipbulContainer;
}

describe('HttpContext', () => {
  it('should return undefined container when not provided in constructor', () => {
    const request = createStubRequest();
    const response = createStubResponse();

    const context = new HttpContext(request, response);

    expect(context.container).toBeUndefined();
  });

  it('should return provided container via getter', () => {
    const request = createStubRequest();
    const response = createStubResponse();
    const container = createStubContainer();

    const context = new HttpContext(request, response, undefined, container);

    expect(context.container).toBe(container);
  });

  it('should resolve to HttpContext via to() when container is present', () => {
    const request = createStubRequest();
    const response = createStubResponse();
    const container = createStubContainer();

    const context = new HttpContext(request, response, undefined, container);
    const resolved = context.to(HttpContext);

    expect(resolved).toBe(context);
  });

  it('should expose request and response alongside container', () => {
    const request = createStubRequest();
    const response = createStubResponse();
    const container = createStubContainer();

    const context = new HttpContext(request, response, undefined, container);

    expect(context.request).toBe(request);
    expect(context.response).toBe(response);
    expect(context.container).toBe(container);
  });

  it('consumeRawRequest returns raw request and then undefined', () => {
    const rawReq = new Request('http://localhost/test');
    const ctx = new HttpContext(createStubRequest(), createStubResponse(), rawReq);

    expect(ctx.consumeRawRequest()).toBe(rawReq);
    expect(ctx.consumeRawRequest()).toBeUndefined();
    expect(ctx.rawRequest).toBeUndefined();
  });

  describe('Context State Store (set/get)', () => {
    it('set and get a typed value', () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());
      const key = contextKey<number>('counter');

      ctx.set(key, 42);

      expect(ctx.get(key)).toBe(42);
    });

    it('get returns undefined for unset key', () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());
      const key = contextKey<string>('missing');

      expect(ctx.get(key)).toBeUndefined();
    });

    it('different keys are independent', () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());
      const keyA = contextKey<string>('alpha');
      const keyB = contextKey<number>('beta');

      ctx.set(keyA, 'hello');
      ctx.set(keyB, 99);

      expect(ctx.get(keyA)).toBe('hello');
      expect(ctx.get(keyB)).toBe(99);
    });

    it('overwrite existing value', () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());
      const key = contextKey<string>('mutable');

      ctx.set(key, 'first');
      ctx.set(key, 'second');

      expect(ctx.get(key)).toBe('second');
    });

    it('supports various value types (string, object, array, null)', () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());
      const stringKey = contextKey<string>('str');
      const objectKey = contextKey<{ id: number }>('obj');
      const arrayKey = contextKey<number[]>('arr');
      const nullKey = contextKey<null>('nil');

      ctx.set(stringKey, 'text');
      ctx.set(objectKey, { id: 1 });
      ctx.set(arrayKey, [1, 2, 3]);
      ctx.set(nullKey, null);

      expect(ctx.get(stringKey)).toBe('text');
      expect(ctx.get(objectKey)).toEqual({ id: 1 });
      expect(ctx.get(arrayKey)).toEqual([1, 2, 3]);
      expect(ctx.get(nullKey)).toBeNull();
    });
  });

  // ── pipelineError ──────────────────────────────────────────

  describe('pipelineError', () => {
    it('should be undefined by default', () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());

      expect(ctx.pipelineError).toBeUndefined();
    });

    it('should be settable and readable', () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());
      const errorData = { status: 400, message: 'Bad Request' } as const;

      ctx.pipelineError = errorData;

      expect(ctx.pipelineError).toBe(errorData);
    });
  });

  // ── set() with symbol key (runtime type of ContextKey) ─────

  describe('set with symbol key', () => {
    it('should store and retrieve value using contextKey (symbol at runtime)', () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());
      const key = contextKey<{ id: number }>('user');
      const value = { id: 123 };

      ctx.set(key, value);

      expect(ctx.get(key)).toBe(value);
      expect(typeof key).toBe('symbol');
    });

    it('should return undefined for a different symbol with same description', () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());
      const keyA = contextKey<string>('same-name');
      const keyB = contextKey<string>('same-name');

      ctx.set(keyA, 'value-a');

      expect(ctx.get(keyA)).toBe('value-a');
      expect(ctx.get(keyB)).toBeUndefined();
    });
  });

  // ── to() with unknown class ────────────────────────────────

  describe('to with unknown class', () => {
    it('should throw ContextError when casting to unknown class', () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());

      class UnknownContext {}

      expect(() => ctx.to(UnknownContext)).toThrow('Context cast failed');
    });
  });

  // ── use() ─────────────────────────────────────────────────

  describe('use', () => {
    it('should return value when key is set', () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());
      const key = contextKey<string>('present');
      ctx.set(key, 'hello');

      expect(ctx.use(key)).toBe('hello');
    });

    it('should throw when key is not set', () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());
      const key = contextKey<string>('absent');

      expect(() => ctx.use(key)).toThrow('Context key not set');
    });

    it('should return null when key is set to null', () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());
      const key = contextKey<null>('nullable');
      ctx.set(key, null);

      expect(ctx.use(key)).toBeNull();
    });
  });

  // ── getType ────────────────────────────────────────────────

  describe('getType', () => {
    it('should return the HTTP_CONTEXT_TYPE constant value', () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());

      expect(ctx.getType()).toBe('http');
    });
  });

  // ── matchedRoute ───────────────────────────────────────────

  describe('matchedRoute', () => {
    it('setter and getter round-trip', () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());
      const route = {
        rawBody: false,
        sse: false,
        handler: mock(() => {}),
        validations: [],
      } as unknown as import('./types').MatchedRouteMetadata;

      ctx.matchedRoute = route;

      expect(ctx.matchedRoute).toBe(route);
    });

    it('returns undefined when not set', () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());

      expect(ctx.matchedRoute).toBeUndefined();
    });

    it('can be set to undefined after being set', () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());
      const route = {
        rawBody: false,
        sse: false,
        handler: mock(() => {}),
        validations: [],
      } as unknown as import('./types').MatchedRouteMetadata;

      ctx.matchedRoute = route;
      ctx.matchedRoute = undefined;

      expect(ctx.matchedRoute).toBeUndefined();
    });
  });

  // ── setTimeout (Bun per-request idle timeout override) ─────

  describe('setTimeout', () => {
    it('should call server.timeout with the raw request and seconds', () => {
      const rawRequest = new Request('http://localhost/test');
      const timeoutSpy = mock((_req: Request, _seconds: number) => undefined);
      const server = { timeout: timeoutSpy } as unknown as import('bun').Server<undefined>;

      const ctx = new HttpContext(createStubRequest(), createStubResponse(), rawRequest, undefined, server);
      ctx.setTimeout(60);

      expect(timeoutSpy).toHaveBeenCalledTimes(1);
      expect(timeoutSpy.mock.calls[0]![0]).toBe(rawRequest);
      expect(timeoutSpy.mock.calls[0]![1]).toBe(60);
    });

    it('should pass 0 through for infinite timeout (SSE pattern)', () => {
      const rawRequest = new Request('http://localhost/events');
      const timeoutSpy = mock((_req: Request, _seconds: number) => undefined);
      const server = { timeout: timeoutSpy } as unknown as import('bun').Server<undefined>;

      const ctx = new HttpContext(createStubRequest(), createStubResponse(), rawRequest, undefined, server);
      ctx.setTimeout(0);

      expect(timeoutSpy.mock.calls[0]![1]).toBe(0);
    });

    it('should be no-op when server is undefined', () => {
      const rawRequest = new Request('http://localhost/test');
      const ctx = new HttpContext(createStubRequest(), createStubResponse(), rawRequest);

      expect(() => ctx.setTimeout(30)).not.toThrow();
    });

    it('should be no-op when rawRequest is undefined', () => {
      const timeoutSpy = mock((_req: Request, _seconds: number) => undefined);
      const server = { timeout: timeoutSpy } as unknown as import('bun').Server<undefined>;

      const ctx = new HttpContext(createStubRequest(), createStubResponse(), undefined, undefined, server);
      ctx.setTimeout(30);

      expect(timeoutSpy).not.toHaveBeenCalled();
    });

    it('should still work after consumeRawRequest clears the main reference', () => {
      const rawRequest = new Request('http://localhost/test');
      const timeoutSpy = mock((_req: Request, _seconds: number) => undefined);
      const server = { timeout: timeoutSpy } as unknown as import('bun').Server<undefined>;

      const ctx = new HttpContext(createStubRequest(), createStubResponse(), rawRequest, undefined, server);
      ctx.consumeRawRequest();
      ctx.setTimeout(0);

      expect(timeoutSpy).toHaveBeenCalledTimes(1);
      expect(timeoutSpy.mock.calls[0]![0]).toBe(rawRequest);
    });
  });
});
