import { describe, it, expect, mock } from 'bun:test';

import { contextKey, type ZipbulContainer } from '@zipbul/common';
import type { Logger } from '@zipbul/logger';

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

  describe('Response Finalizer', () => {
    function createMockLogger(): Logger {
      return { error: mock(() => {}) } as unknown as Logger;
    }

    it('addResponseFinalizer + runResponseFinalizers runs in LIFO order', async () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());
      const logger = createMockLogger();
      const order: string[] = [];

      ctx.addResponseFinalizer('first', () => { order.push('first'); });
      ctx.addResponseFinalizer('second', () => { order.push('second'); });

      await ctx.runResponseFinalizers(logger);

      expect(order).toEqual(['second', 'first']);
    });

    it('single finalizer runs', async () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());
      const logger = createMockLogger();
      const executed = mock(() => {});

      ctx.addResponseFinalizer('only', executed);

      await ctx.runResponseFinalizers(logger);

      expect(executed).toHaveBeenCalledTimes(1);
    });

    it('empty finalizers (no-op)', async () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());
      const logger = createMockLogger();

      await ctx.runResponseFinalizers(logger);

      expect(logger.error).not.toHaveBeenCalled();
    });

    it('finalizer that throws: error logged, remaining finalizers still run', async () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());
      const logger = createMockLogger();
      const order: string[] = [];
      const thrownError = new Error('finalizer boom');

      ctx.addResponseFinalizer('before', () => { order.push('before'); });
      ctx.addResponseFinalizer('failing', () => { throw thrownError; });
      ctx.addResponseFinalizer('after', () => { order.push('after'); });

      await ctx.runResponseFinalizers(logger);

      expect(order).toEqual(['after', 'before']);
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith("Response finalizer 'failing' failed", thrownError);
    });

    it('async finalizer works', async () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());
      const logger = createMockLogger();
      let value = 0;

      ctx.addResponseFinalizer('async', async () => {
        await Promise.resolve();
        value = 1;
      });

      await ctx.runResponseFinalizers(logger);

      expect(value).toBe(1);
    });

    it('mixed sync/async finalizers', async () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());
      const logger = createMockLogger();
      const order: string[] = [];

      ctx.addResponseFinalizer('sync', () => { order.push('sync'); });
      ctx.addResponseFinalizer('async', async () => {
        await Promise.resolve();
        order.push('async');
      });

      await ctx.runResponseFinalizers(logger);

      expect(order).toEqual(['async', 'sync']);
    });

    it('LIFO order with 3+ finalizers', async () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());
      const logger = createMockLogger();
      const order: string[] = [];

      ctx.addResponseFinalizer('alpha', () => { order.push('alpha'); });
      ctx.addResponseFinalizer('beta', () => { order.push('beta'); });
      ctx.addResponseFinalizer('gamma', () => { order.push('gamma'); });
      ctx.addResponseFinalizer('delta', () => { order.push('delta'); });

      await ctx.runResponseFinalizers(logger);

      expect(order).toEqual(['delta', 'gamma', 'beta', 'alpha']);
    });

    it('should run first and last finalizers when middle one throws', async () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());
      const logger = createMockLogger();
      const order: string[] = [];

      ctx.addResponseFinalizer('first', () => { order.push('first'); });
      ctx.addResponseFinalizer('middle-fail', () => { throw new Error('middle boom'); });
      ctx.addResponseFinalizer('last', () => { order.push('last'); });

      await ctx.runResponseFinalizers(logger);

      expect(order).toContain('first');
      expect(order).toContain('last');
      expect(logger.error).toHaveBeenCalledTimes(1);
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

  // ── getValidated edge cases ────────────────────────────────

  describe('getValidated edge cases', () => {
    it('should throw ContextError when validated kind has not been set', () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());

      expect(() => ctx.getValidated('body')).toThrow("Validated 'body' not available");
    });

    it('should return undefined when validated kind was explicitly set to undefined', () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());
      ctx.setValidated('query', undefined);

      expect(ctx.getValidated('query')).toBeUndefined();
    });
  });

  // ── getType ────────────────────────────────────────────────

  describe('getType', () => {
    it('should return the HTTP_CONTEXT_TYPE constant value', () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());

      expect(ctx.getType()).toBe('http');
    });
  });

  // ── Validated accessors (getBody / getQuery / getParams) ───

  describe('Validated accessors', () => {
    it('getBody returns validated body after setValidated', () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());
      const body = { name: 'test', age: 30 };

      ctx.setValidated('body', body);

      expect(ctx.getBody()).toBe(body);
    });

    it('getQuery returns validated query after setValidated', () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());
      const query = { page: 1, limit: 10 };

      ctx.setValidated('query', query);

      expect(ctx.getQuery()).toBe(query);
    });

    it('getParams returns validated params after setValidated', () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());
      const params = { id: '123', slug: 'hello' };

      ctx.setValidated('params', params);

      expect(ctx.getParams()).toBe(params);
    });

    it('getBody throws when body has not been validated', () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());

      expect(() => ctx.getBody()).toThrow("Validated 'body' not available");
    });

    it('getQuery throws when query has not been validated', () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());

      expect(() => ctx.getQuery()).toThrow("Validated 'query' not available");
    });

    it('getParams throws when params have not been validated', () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());

      expect(() => ctx.getParams()).toThrow("Validated 'params' not available");
    });
  });

  // ── routeExceptionFilters ──────────────────────────────────

  describe('routeExceptionFilters', () => {
    it('setRouteExceptionFilters stores and routeExceptionFilters retrieves', () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());
      const filters = [
        { token: class TestFilter {}, handle: mock(() => {}) },
      ] as unknown as readonly import('@zipbul/common').ResolvedExceptionFilter[];

      ctx.setRouteExceptionFilters(filters);

      expect(ctx.routeExceptionFilters).toBe(filters);
    });

    it('routeExceptionFilters returns undefined when not set', () => {
      const ctx = new HttpContext(createStubRequest(), createStubResponse());

      expect(ctx.routeExceptionFilters).toBeUndefined();
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
});
