import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { Context, ZipbulContainer } from '@zipbul/common';
import { defineMiddleware, defineGuard, defineExceptionFilter } from '@zipbul/common';
import { err, isErr } from '@zipbul/result';
import type { Result } from '@zipbul/result';
import { HttpRequest } from './http-request';
import { HttpContext } from './http-context';
import { HttpResponse } from './http-response';
import { parseBody } from './body';
import type { ErrorResponseData, HttpRequestData, RouteHandlerResult } from './types';
import { writeErrorResponse, writeSuccessResponse } from './response-writer';
import { HttpPhase } from './enums';
import { createTestHttpRequest } from './test-fixtures/http-request-fixture';
import { assertDefined } from './test-fixtures/assertions';


const mockGetBootstrapState = mock(() => ({
  isAotRuntime: false,
  metadataRegistry: new Map(),
}));

const { Adapter, handlerResultKey } = await import('../../core/src/adapter/adapter');
const { CoreStep } = await import('../../core/src/adapter/enums');
const { runInInjectionContext } = await import('../../core/src/injection-context');
const { getAdapterContext, runInAdapterContext } = await import('../../core/src/adapter-context');

mock.module('@zipbul/core', () => ({
  Adapter,
  CoreStep,
  handlerResultKey,
  getAdapterContext,
  runInAdapterContext,
  runInInjectionContext,
  ClusterManager: class {},
  getBootstrapState: mockGetBootstrapState,
}));

mock.module('@zipbul/logger', () => ({
  Logger: class {
    static runScoped(_logger: unknown, fn: () => unknown) { return fn(); }
    constructor() {}
    debug() {}
    info() {}
    warn() {}
    error() {}
  },
}));

const { HttpAdapter } = await import('./http-adapter');

type HttpAdapterInstance = InstanceType<typeof HttpAdapter>;

describe('HttpAdapter', () => {
  // ── Option Override ─────────────────────────────────────

  describe('constructor options', () => {
    it('should use all defaults when no options provided', () => {
      // Arrange & Act
      const adapter = new HttpAdapter();

      // Assert — access via private field through any
      const opts = (adapter as unknown as { options: Record<string, unknown> }).options;
      expect(opts.port).toBe(5000);
      expect(opts.bodyLimit).toBe(10 * 1024 * 1024);
      expect(opts.trustProxy).toBe(false);
      expect(opts.name).toBe('zipbul-http');
      expect(opts.logLevel).toBe('debug');
    });

    it('should allow user to override name', () => {
      // Arrange & Act
      const adapter = new HttpAdapter({ name: 'my-app' });

      // Assert
      const opts = (adapter as unknown as { options: Record<string, unknown> }).options;
      expect(opts.name).toBe('my-app');
    });

    it('should allow user to override logLevel', () => {
      // Arrange & Act
      const adapter = new HttpAdapter({ logLevel: 'info' });

      // Assert
      const opts = (adapter as unknown as { options: Record<string, unknown> }).options;
      expect(opts.logLevel).toBe('info');
    });

    it('should allow user to override port', () => {
      // Arrange & Act
      const adapter = new HttpAdapter({ port: 3000 });

      // Assert
      const opts = (adapter as unknown as { options: Record<string, unknown> }).options;
      expect(opts.port).toBe(3000);
    });

    it('should allow user to override bodyLimit', () => {
      // Arrange & Act
      const adapter = new HttpAdapter({ bodyLimit: 1024 });

      // Assert
      const opts = (adapter as unknown as { options: Record<string, unknown> }).options;
      expect(opts.bodyLimit).toBe(1024);
    });

    it('should allow user to override trustProxy', () => {
      // Arrange & Act
      const adapter = new HttpAdapter({ trustProxy: true });

      // Assert
      const opts = (adapter as unknown as { options: Record<string, unknown> }).options;
      expect(opts.trustProxy).toBe(true);
    });

    it('should keep defaults for non-specified options when partially overriding', () => {
      // Arrange & Act
      const adapter = new HttpAdapter({ port: 8080 });

      // Assert
      const opts = (adapter as unknown as { options: Record<string, unknown> }).options;
      expect(opts.port).toBe(8080);
      expect(opts.name).toBe('zipbul-http');
      expect(opts.logLevel).toBe('debug');
    });
  });

  // ── Route-Level Guard Execution ─────────────────────────

  describe('executeHandler route-level guards', () => {
    let adapter: HttpAdapterInstance;

    beforeEach(() => {
      adapter = new HttpAdapter();
      adapter.initializePipeline(createMockContainer());
    });

    it('should execute handler when route has no guards', async () => {
      // Arrange
      const handlerFn = mock(() => ({ data: 'ok' }));
      const mockRouteHandler = {
        matchRoute: mock(() => ({
          kind: 'matched',
          params: {},
          route: {
            handler: handlerFn,
            rawBody: false,
            sse: false,
            bodyLimit: undefined,
            status: undefined,
            redirect: undefined,
            contentType: undefined,
            headers: [],
            pre: [],
            post: [],
            filters: [],
            validations: [],
          },
        })),
      };
      adapter.setRouteHandler(mockRouteHandler as never);

      const context = createHttpContext('GET', '/test');

      // Act
      await adapter.dispatchRequest(context);

      // Assert
      expect(handlerFn).toHaveBeenCalled();
    });

    it('should execute handler when guard passes', async () => {
      // Arrange
      const guardHandler = mock(() => undefined);
      const handlerFn = mock(() => ({ data: 'ok' }));
      const mockRouteHandler = {
        matchRoute: mock(() => ({
          kind: 'matched',
          params: {},
          route: {
            handler: handlerFn,
            rawBody: false,
            sse: false,
            bodyLimit: undefined,
            status: undefined,
            redirect: undefined,
            contentType: undefined,
            headers: [],
            pre: [guardHandler],
            post: [],
            filters: [],
            validations: [],
          },
        })),
      };
      adapter.setRouteHandler(mockRouteHandler as never);

      const context = createHttpContext('GET', '/test');

      // Act
      await adapter.dispatchRequest(context);

      // Assert
      expect(guardHandler).toHaveBeenCalledTimes(1);
      expect(handlerFn).toHaveBeenCalled();
    });

    it('should skip handler when guard denies', async () => {
      // Arrange
      const guardHandler = mock(() => err({ status: 403, message: 'Forbidden' }));
      const handlerFn = mock(() => ({ data: 'ok' }));
      const mockRouteHandler = {
        matchRoute: mock(() => ({
          kind: 'matched',
          params: {},
          route: {
            handler: handlerFn,
            rawBody: false,
            sse: false,
            bodyLimit: undefined,
            status: undefined,
            redirect: undefined,
            contentType: undefined,
            headers: [],
            pre: [guardHandler],
            post: [],
            filters: [],
            validations: [],
          },
        })),
      };
      adapter.setRouteHandler(mockRouteHandler as never);

      const context = createHttpContext('GET', '/test');

      // Act
      await adapter.dispatchRequest(context);

      // Assert — result stored on context via handlerResultKey
      const receivedResult = context.get(handlerResultKey);
      expect(isErr(receivedResult)).toBe(true);
      expect(handlerFn).not.toHaveBeenCalled();
    });

    it('should execute multiple guards in order', async () => {
      // Arrange
      const callOrder: number[] = [];
      const guard1 = mock(() => { callOrder.push(1); return undefined; });
      const guard2 = mock(() => { callOrder.push(2); return undefined; });
      const handlerFn = mock(() => ({ data: 'ok' }));
      const mockRouteHandler = {
        matchRoute: mock(() => ({
          kind: 'matched',
          params: {},
          route: {
            handler: handlerFn,
            rawBody: false,
            sse: false,
            bodyLimit: undefined,
            status: undefined,
            redirect: undefined,
            contentType: undefined,
            headers: [],
            pre: [guard1, guard2],
            post: [],
            filters: [],
            validations: [],
          },
        })),
      };
      adapter.setRouteHandler(mockRouteHandler as never);

      const context = createHttpContext('GET', '/test');

      // Act
      await adapter.dispatchRequest(context);

      // Assert
      expect(callOrder).toEqual([1, 2]);
    });

    it('should short-circuit when first guard fails in a chain', async () => {
      // Arrange
      const guard1 = mock(() => err({ status: 401 }));
      const guard2 = mock(() => undefined);
      const handlerFn = mock(() => ({ data: 'ok' }));
      const mockRouteHandler = {
        matchRoute: mock(() => ({
          kind: 'matched',
          params: {},
          route: {
            handler: handlerFn,
            rawBody: false,
            sse: false,
            bodyLimit: undefined,
            status: undefined,
            redirect: undefined,
            contentType: undefined,
            headers: [],
            pre: [guard1, guard2],
            post: [],
            filters: [],
            validations: [],
          },
        })),
      };
      adapter.setRouteHandler(mockRouteHandler as never);

      const context = createHttpContext('GET', '/test');

      // Act
      await adapter.dispatchRequest(context);

      // Assert
      expect(guard1).toHaveBeenCalledTimes(1);
      expect(guard2).not.toHaveBeenCalled();
      expect(handlerFn).not.toHaveBeenCalled();
    });

    it('should pass async guard that resolves to undefined', async () => {
      // Arrange
      const guardHandler = mock(async () => undefined);
      const handlerFn = mock(() => ({ data: 'ok' }));
      const mockRouteHandler = {
        matchRoute: mock(() => ({
          kind: 'matched',
          params: {},
          route: {
            handler: handlerFn,
            rawBody: false,
            sse: false,
            bodyLimit: undefined,
            status: undefined,
            redirect: undefined,
            contentType: undefined,
            headers: [],
            pre: [guardHandler],
            post: [],
            filters: [],
            validations: [],
          },
        })),
      };
      adapter.setRouteHandler(mockRouteHandler as never);

      const context = createHttpContext('GET', '/test');

      // Act
      await adapter.dispatchRequest(context);

      // Assert
      expect(handlerFn).toHaveBeenCalled();
    });

    it('should pass correct context to guard handler', async () => {
      // Arrange
      let receivedContext: Context | undefined;
      const guardHandler = mock((ctx: Context) => { receivedContext = ctx; return undefined; });
      const handlerFn = mock(() => ({ data: 'ok' }));
      const mockRouteHandler = {
        matchRoute: mock(() => ({
          kind: 'matched',
          params: {},
          route: {
            handler: handlerFn,
            rawBody: false,
            sse: false,
            bodyLimit: undefined,
            status: undefined,
            redirect: undefined,
            contentType: undefined,
            headers: [],
            pre: [guardHandler],
            post: [],
            filters: [],
            validations: [],
          },
        })),
      };
      adapter.setRouteHandler(mockRouteHandler as never);

      const context = createHttpContext('GET', '/test');

      // Act
      await adapter.dispatchRequest(context);

      // Assert
      expect(receivedContext).toBe(context);
    });
  });
});

/**
 * Typed factory. Returns a real {@link HttpRequest} — no `as unknown as`
 * casts. Tests that previously injected computed getter fields (`protocol`,
 * `host`, etc.) should seed the raw inputs instead; the getters resolve
 * naturally from them.
 */
function createStubHttpRequest(overrides: Partial<HttpRequestData> = {}): HttpRequest {
  return createTestHttpRequest({
    originalUrl: 'http://localhost/test',
    url: 'http://localhost/test',
    path: '/test',
    ...overrides,
  });
}

function createHttpContext(method: string, path: string, signal?: AbortSignal): HttpContext {
  const url = new URL(`http://localhost${path}`);
  const req = createTestHttpRequest({
    originalMethod: method,
    originalUrl: `http://localhost${path}`,
    method,
    url: `http://localhost${path}`,
    path,
    ...(url.search ? { queryString: url.search } : {}),
    ...(signal !== undefined ? { signal } : {}),
  } as Partial<HttpRequestData>);
  const res = new HttpResponse(req, new Headers());
  return new HttpContext(req, res);
}

function createHttpContextWithSignal(method: string, path: string, signal: AbortSignal): HttpContext {
  return createHttpContext(method, path, signal);
}

function setSseRoute(context: HttpContext): void {
  const http = context.to(HttpContext);
  http.matchedRoute = {
    rawBody: false,
    sse: true,
    bodyLimit: undefined,
    status: undefined,
    redirect: undefined,
    contentType: undefined,
    headers: [],
    pre: [],
    post: [],
    filters: [],
    handler: () => undefined,
    validations: [],
  };
}

function createMockContainer(): ZipbulContainer {
  return {
    get: () => undefined,
    set: () => {},
    has: () => false,
    getInstances: () => [][Symbol.iterator](),
    keys: () => [][Symbol.iterator](),
  } as unknown as ZipbulContainer;
}

/**
 * Replaces the removed `handleResult` method.
 * Sets the handler result on context via `handlerResultKey`, then invokes
 * writeErrorResponse / writeSuccessResponse module functions.
 */
async function writeResult(
  _adapter: InstanceType<typeof HttpAdapter>,
  result: Result<RouteHandlerResult, ErrorResponseData> | undefined,
  context: Context,
): Promise<void> {
  const http = context.to(HttpContext);
  context.set(handlerResultKey, result);

  if (http.response.isSent() || result === undefined) return;

  if (isErr(result)) {
    writeErrorResponse(http.response, result.data);
  } else {
    await writeSuccessResponse(http.response, result, http);
  }

  http.response.serialize();
}

function createMockRouteHandler(options: {
  pre?: Array<(ctx: Context) => unknown>;
  filters?: Array<{ handler: (error: unknown, ctx: Context) => unknown; catchTypes: readonly (abstract new (...args: never[]) => Error)[] }>;
  handler?: (...args: readonly unknown[]) => unknown;
}) {
  return {
    matchRoute: mock(() => ({
      kind: 'matched',
      params: {},
      route: {
        handler: options.handler ?? mock(() => ({ data: 'ok' })),
        rawBody: false,
        sse: false,
        bodyLimit: undefined,
        status: undefined,
        redirect: undefined,
        contentType: undefined,
        headers: [],
        pre: options.pre ?? [],
        post: [],
        filters: options.filters ?? [],
        validations: [],
      },
    })),
  };
}

// ── Route-Level Middleware Pipeline Integration ─────────────────

describe('HttpAdapter route-level middleware pipeline', () => {
  let adapter: InstanceType<typeof HttpAdapter>;

  beforeEach(() => {
    adapter = new HttpAdapter();
  });

  // ── Execution Order ──────────────────────────────────────────

  describe('execution order', () => {
    it('should execute full pipeline: OnReceive → resolveRoute → pre (PostParse → GlobalGuard → PreHandle → RouteMW → RouteGuard) → Handler → OnComplete', async () => {
      // Arrange
      const order: string[] = [];

      adapter.addMiddlewares(HttpPhase.OnRequest, [defineMiddleware(() => () => { order.push('global:OnReceive'); })]);
      adapter.addMiddlewares(HttpPhase.AfterResponse, [defineMiddleware(() => () => { order.push('global:OnComplete'); })]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        pre: [
          () => { order.push('global:PostParse'); },
          () => { order.push('global:guard'); },
          () => { order.push('global:PreHandle'); },
          () => { order.push('route:mw1'); },
          () => { order.push('route:mw2'); },
          () => { order.push('route:guard'); },
        ],
        handler: () => { order.push('handler'); return { data: 'ok' }; },
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(order).toEqual([
        'global:OnReceive',
        'global:PostParse',
        'global:guard',
        'global:PreHandle',
        'route:mw1',
        'route:mw2',
        'route:guard',
        'handler',
        'global:OnComplete',
      ]);
    });

    it('should execute multiple global middlewares per phase in registration order', async () => {
      // Arrange
      const order: string[] = [];

      adapter.addMiddlewares(HttpPhase.OnRequest, [
        defineMiddleware(() => () => { order.push('OnReceive:1'); }),
        defineMiddleware(() => () => { order.push('OnReceive:2'); }),
      ]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        pre: [
          () => { order.push('PreHandle:1'); },
          () => { order.push('PreHandle:2'); },
          () => { order.push('route:mw'); },
        ],
        handler: () => { order.push('handler'); return 'ok'; },
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(order).toEqual([
        'OnReceive:1',
        'OnReceive:2',
        'PreHandle:1',
        'PreHandle:2',
        'route:mw',
        'handler',
      ]);
    });

    it('should place global guards after PostParse and before PreHandle', async () => {
      // Arrange
      const order: string[] = [];

      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        pre: [
          () => { order.push('PostParse'); },
          () => { order.push('global:guard'); },
          () => { order.push('PreHandle'); },
        ],
        handler: () => { order.push('handler'); return 'ok'; },
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(order).toEqual(['PostParse', 'global:guard', 'PreHandle', 'handler']);
    });
  });

  // ── Short-Circuit Behavior ──────────────────────────────────

  describe('short-circuit', () => {
    it('should skip everything after OnReceive when OnReceive returns Err', async () => {
      // Arrange
      const routeMw = mock((_ctx: Context) => {});
      const handlerFn = mock(() => 'ok');

      adapter.addMiddlewares(HttpPhase.OnRequest, [defineMiddleware(() => () => err({ status: 429 }))]);
      adapter.addMiddlewares(HttpPhase.BeforeValidate, [defineMiddleware(() => () => { throw new Error('should not run'); })]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        pre: [routeMw],
        handler: handlerFn,
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(routeMw).not.toHaveBeenCalled();
      expect(handlerFn).not.toHaveBeenCalled();
    });

    it('should skip route-level after PostParse Err but run OnReceive', async () => {
      // Arrange
      const order: string[] = [];

      adapter.addMiddlewares(HttpPhase.OnRequest, [defineMiddleware(() => () => { order.push('OnReceive'); })]);
      adapter.initializePipeline(createMockContainer());

      const routeMw = mock((_ctx: Context) => {});
      const routeHandler = createMockRouteHandler({
        pre: [
          () => { order.push('PostParse:halt'); return err({ status: 400 }); },
          routeMw,
        ],
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(order).toEqual(['OnReceive', 'PostParse:halt']);
      expect(routeMw).not.toHaveBeenCalled();
    });

    it('should skip route-level middlewares when global PreHandle returns Err', async () => {
      // Arrange
      const routeMw = mock((_ctx: Context) => {});

      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        pre: [() => err({ status: 503 }), routeMw],
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(routeMw).not.toHaveBeenCalled();
    });

    it('should skip route-level when global guard denies (before PreHandle)', async () => {
      // Arrange
      const order: string[] = [];
      const routeMw = mock((_ctx: Context) => { order.push('route:mw'); });
      const preHandleMw = mock((_ctx: Context) => { order.push('PreHandle'); });

      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        pre: [
          () => { order.push('global:guard:deny'); return err({ status: 403 }); },
          preHandleMw,
          routeMw,
        ],
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(order).toEqual(['global:guard:deny']);
      expect(preHandleMw).not.toHaveBeenCalled();
      expect(routeMw).not.toHaveBeenCalled();
    });

    it('should halt at first route-level middleware when it returns Err', async () => {
      // Arrange
      const guardFn = mock((_ctx: Context) => {});
      const handlerFn = mock(() => 'ok');

      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        pre: [
          () => err({ reason: 'first_halt' }),
          () => { throw new Error('should not run'); },
          guardFn,
        ],
        handler: handlerFn,
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(guardFn).not.toHaveBeenCalled();
      expect(handlerFn).not.toHaveBeenCalled();
    });

    it('should halt at last route-level middleware when it returns Err after others pass', async () => {
      // Arrange
      const order: string[] = [];
      const guardFn = mock((_ctx: Context) => {});

      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        pre: [
          () => { order.push('mw1'); },
          () => { order.push('mw2'); },
          () => { order.push('mw3:halt'); return err({ reason: 'last_halt' }); },
          guardFn,
        ],
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(order).toEqual(['mw1', 'mw2', 'mw3:halt']);
      expect(guardFn).not.toHaveBeenCalled();
    });

    it('should skip route-level guards and handler when middle middleware returns Err', async () => {
      // Arrange
      const order: string[] = [];
      const guardFn = mock((_ctx: Context) => { order.push('guard'); });
      const handlerFn = mock(() => { order.push('handler'); return 'ok'; });

      adapter.addMiddlewares(HttpPhase.OnRequest, [defineMiddleware(() => () => { order.push('global:OnReceive'); })]);
      adapter.addMiddlewares(HttpPhase.AfterResponse, [defineMiddleware(() => () => { order.push('global:OnComplete'); })]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        pre: [
          () => { order.push('route:mw1'); },
          () => { order.push('route:mw2:halt'); return err({ status: 401 }); },
          () => { order.push('route:mw3'); },
          guardFn,
        ],
        handler: handlerFn,
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(order).toEqual([
        'global:OnReceive',
        'route:mw1',
        'route:mw2:halt',
        'global:OnComplete',
      ]);
      expect(guardFn).not.toHaveBeenCalled();
      expect(handlerFn).not.toHaveBeenCalled();
    });

    it('should still run OnComplete when route-level middleware halts', async () => {
      // Arrange
      const onCompleteFn = mock((_ctx: Context) => {});

      adapter.addMiddlewares(HttpPhase.AfterResponse, [defineMiddleware(() => onCompleteFn)]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        pre: [() => err({ reason: 'halt' })],
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(onCompleteFn).toHaveBeenCalledTimes(1);
    });

    it('should still run OnComplete when global guard denies', async () => {
      // Arrange
      const onCompleteFn = mock((_ctx: Context) => {});

      adapter.addGuards([defineGuard(() => () => err({ status: 403 }))]);
      adapter.addMiddlewares(HttpPhase.AfterResponse, [defineMiddleware(() => onCompleteFn)]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({});
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(onCompleteFn).toHaveBeenCalledTimes(1);
    });
  });

  // ── Err Data Propagation ──────────────────────────────────

  describe('Err data propagation', () => {
    it('should flow route-level middleware Err data through to WriteResponse', async () => {
      // Arrange
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        pre: [() => err({ status: 401, message: 'Unauthorized' })],
      });
      adapter.setRouteHandler(routeHandler as never);

      const context = createHttpContext('GET', '/test');

      // Act
      await adapter.dispatchRequest(context);

      // Assert — result stored on context via handlerResultKey
      const receivedResult = context.get(handlerResultKey);
      expect(isErr(receivedResult)).toBe(true);
      expect((receivedResult as { data: unknown }).data).toEqual({ status: 401, message: 'Unauthorized' });
    });

    it('should flow route-level guard Err data through to WriteResponse', async () => {
      // Arrange
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        pre: [() => err({ status: 403, message: 'Forbidden' })],
      });
      adapter.setRouteHandler(routeHandler as never);

      const context = createHttpContext('GET', '/test');

      // Act
      await adapter.dispatchRequest(context);

      // Assert — result stored on context via handlerResultKey
      const receivedResult = context.get(handlerResultKey);
      expect(isErr(receivedResult)).toBe(true);
      expect((receivedResult as { data: unknown }).data).toEqual({ status: 403, message: 'Forbidden' });
    });
  });

  // ── Guard Err vs Exception Path ──────────────────────────

  describe('guard Err vs exception path', () => {
    it('should NOT invoke exception filters when guard returns Err (Err is a normal result, not exception)', async () => {
      // Arrange
      const globalFilter = mock((_error: unknown, _ctx: Context) => err({ source: 'filter' }));

      adapter.addExceptionFilters([defineExceptionFilter([], () => globalFilter)]);
      adapter.initializePipeline(createMockContainer());

      const routeFilterHandler = mock((_error: unknown, _ctx: Context) => err({ source: 'route-filter' }));
      const routeHandler = createMockRouteHandler({
        pre: [() => err({ status: 403 })],
        filters: [{ handler: routeFilterHandler, catchTypes: [] }],
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert — Err from guard goes directly to WriteResponse, NOT through exception filters
      expect(globalFilter).not.toHaveBeenCalled();
      expect(routeFilterHandler).not.toHaveBeenCalled();
    });

    it('should NOT invoke exception filters when route-level middleware returns Err', async () => {
      // Arrange
      const globalFilter = mock((_error: unknown, _ctx: Context) => err({ source: 'filter' }));

      adapter.addExceptionFilters([defineExceptionFilter([], () => globalFilter)]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        pre: [() => err({ status: 429 })],
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(globalFilter).not.toHaveBeenCalled();
    });
  });

  // ── Route-Level Exception Filters ──────────────────────────

  describe('route-level exception filters', () => {
    it('should use route-level exception filter before global filter', async () => {
      // Arrange
      class RouteError extends Error {
        constructor() { super('route error'); }
      }

      const globalFilterHandler = mock((_error: unknown, _ctx: Context) => err({ source: 'global' }));
      const routeFilterHandler = mock((_error: unknown, _ctx: Context) => err({ source: 'route', status: 422 }));

      adapter.addExceptionFilters([defineExceptionFilter([], () => globalFilterHandler)]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        filters: [{ handler: routeFilterHandler, catchTypes: [RouteError] }],
        handler: () => { throw new RouteError(); },
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(routeFilterHandler).toHaveBeenCalledTimes(1);
      expect(globalFilterHandler).not.toHaveBeenCalled();
    });

    it('should fall back to global filter when route-level filter does not match', async () => {
      // Arrange
      class SpecificError extends Error {}
      class DifferentError extends Error {}

      const globalFilterHandler = mock((_error: unknown, _ctx: Context) => err({ source: 'global' }));
      const routeFilterHandler = mock((_error: unknown, _ctx: Context) => err({ source: 'route' }));

      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        filters: [
          { handler: routeFilterHandler, catchTypes: [SpecificError] },
          { handler: globalFilterHandler, catchTypes: [] },
        ],
        handler: () => { throw new DifferentError('different'); },
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(routeFilterHandler).not.toHaveBeenCalled();
      expect(globalFilterHandler).toHaveBeenCalledTimes(1);
    });

    it('should route thrown exception from route-level middleware to route-level exception filter', async () => {
      // Arrange
      class MwError extends Error {
        constructor() { super('mw threw'); }
      }

      const routeFilterHandler = mock((_error: unknown, _ctx: Context) => err({ status: 400, caught: 'route-filter' }));

      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        pre: [() => { throw new MwError(); }],
        filters: [{ handler: routeFilterHandler, catchTypes: [MwError] }],
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(routeFilterHandler).toHaveBeenCalledTimes(1);
      const errorArg = routeFilterHandler.mock.calls[0]![0];
      expect(errorArg).toBeInstanceOf(MwError);
    });

    it('should pass correct error instance and context to route-level exception filter', async () => {
      // Arrange
      class DetailedError extends Error {
        readonly code = 'ERR_DETAIL';
        constructor() { super('detailed'); }
      }

      let capturedError: unknown;
      let capturedCtx: unknown;
      const routeFilterHandler = (error: unknown, ctx: Context) => {
        capturedError = error;
        capturedCtx = ctx;
        return err({ handled: true });
      };

      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        filters: [{ handler: routeFilterHandler, catchTypes: [DetailedError] }],
        handler: () => { throw new DetailedError(); },
      });
      adapter.setRouteHandler(routeHandler as never);

      const context = createHttpContext('GET', '/test');

      // Act
      await adapter.dispatchRequest(context);

      // Assert
      expect(capturedError).toBeInstanceOf(DetailedError);
      expect((capturedError as DetailedError).code).toBe('ERR_DETAIL');
      expect(capturedCtx).toBe(context);
    });
  });

  // ── Async Route-Level Middleware ──────────────────────────

  describe('async route-level middleware', () => {
    it('should handle async route-level middleware that returns void', async () => {
      // Arrange
      const order: string[] = [];

      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        pre: [
          async () => { await Promise.resolve(); order.push('async:mw'); },
        ],
        handler: () => { order.push('handler'); return 'ok'; },
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(order).toEqual(['async:mw', 'handler']);
    });

    it('should halt pipeline when async route-level middleware returns Err', async () => {
      // Arrange
      const handlerFn = mock(() => 'ok');

      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        pre: [
          async () => { await Promise.resolve(); return err({ async: true }); },
        ],
        handler: handlerFn,
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(handlerFn).not.toHaveBeenCalled();
    });

    it('should preserve order with mixed sync and async route-level middlewares', async () => {
      // Arrange
      const order: string[] = [];

      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        pre: [
          () => { order.push('sync:1'); },
          async () => { await Promise.resolve(); order.push('async:2'); },
          () => { order.push('sync:3'); },
        ],
        handler: () => { order.push('handler'); return 'ok'; },
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(order).toEqual(['sync:1', 'async:2', 'sync:3', 'handler']);
    });
  });

  // ── Context Propagation ──────────────────────────────────

  describe('context propagation', () => {
    it('should pass same context to all pipeline stages', async () => {
      // Arrange
      const contexts: Context[] = [];

      adapter.addMiddlewares(HttpPhase.OnRequest, [defineMiddleware(() => (ctx) => { contexts.push(ctx); })]);
      adapter.addMiddlewares(HttpPhase.AfterResponse, [defineMiddleware(() => (ctx) => { contexts.push(ctx); })]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        pre: [
          (ctx) => { contexts.push(ctx); },
          (ctx) => { contexts.push(ctx); },
          (ctx) => { contexts.push(ctx); },
          (ctx) => { contexts.push(ctx); },
          (ctx) => { contexts.push(ctx); },
        ],
      });
      adapter.setRouteHandler(routeHandler as never);

      const context = createHttpContext('GET', '/test');

      // Act
      await adapter.dispatchRequest(context);

      // Assert — 1 OnRequest + 5 pre + 1 AfterResponse = 7
      expect(contexts).toHaveLength(7);
      for (const captured of contexts) {
        expect(captured).toBe(context);
      }
    });
  });

  // ── Global Guard + Route-Level Interaction ──────────────

  describe('global guard + route-level guard interaction', () => {
    it('should run global guards before route-level guards', async () => {
      // Arrange
      const order: string[] = [];

      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        pre: [
          () => { order.push('global:guard'); },
          () => { order.push('route:guard'); },
        ],
        handler: () => { order.push('handler'); return 'ok'; },
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(order).toEqual(['global:guard', 'route:guard', 'handler']);
    });

    it('should skip route-level guards when global guard denies', async () => {
      // Arrange
      const routeGuard = mock((_ctx: Context) => {});
      const handlerFn = mock(() => 'ok');

      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        pre: [() => err({ status: 403 }), routeGuard],
        handler: handlerFn,
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(routeGuard).not.toHaveBeenCalled();
      expect(handlerFn).not.toHaveBeenCalled();
    });
  });

  // ── Route Not Found ──────────────────────────────────────

  describe('route not found', () => {
    it('should skip route-level pipeline when no route matches', async () => {
      // Arrange
      const order: string[] = [];

      adapter.addMiddlewares(HttpPhase.OnRequest, [defineMiddleware(() => () => { order.push('OnReceive'); })]);
      adapter.addMiddlewares(HttpPhase.AfterResponse, [defineMiddleware(() => () => { order.push('OnComplete'); })]);
      adapter.initializePipeline(createMockContainer());

      const noMatchRouteHandler = {
        matchRoute: mock(() => ({ kind: 'not-found' })),
      };
      adapter.setRouteHandler(noMatchRouteHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/nonexistent'));

      // Assert — global phases run, no route-level
      expect(order).toEqual(['OnReceive', 'OnComplete']);
    });

    it('should return 404 Err when no route matches', async () => {
      // Arrange
      adapter.initializePipeline(createMockContainer());

      const noMatchRouteHandler = {
        matchRoute: mock(() => ({ kind: 'not-found' })),
      };
      adapter.setRouteHandler(noMatchRouteHandler as never);

      const context = createHttpContext('GET', '/nonexistent');

      // Act
      await adapter.dispatchRequest(context);

      // Assert — 404 written directly to response (pre-route error path)
      const http = context.to(HttpContext);
      expect(http.response.getStatus()).toBe(404);
    });
  });

  // ── Edge Cases ────────────────────────────────────────────

  describe('edge cases', () => {
    it('should work with empty route-level middleware list', async () => {
      // Arrange
      const order: string[] = [];

      adapter.addMiddlewares(HttpPhase.OnRequest, [defineMiddleware(() => () => { order.push('global'); })]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        pre: [],
        handler: () => { order.push('handler'); return 'ok'; },
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(order).toEqual(['global', 'handler']);
    });

    it('should work with no global middlewares and only route-level middlewares', async () => {
      // Arrange
      const order: string[] = [];

      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        pre: [() => { order.push('route:mw'); }],
        handler: () => { order.push('handler'); return 'ok'; },
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(order).toEqual(['route:mw', 'handler']);
    });

    it('should route thrown exception from route-level middleware through exception filters', async () => {
      // Arrange
      const globalFilter = mock((_error: unknown, _ctx: Context) => err({ caught: true }));

      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        pre: [() => { throw new Error('middleware crash'); }],
        filters: [{ handler: globalFilter, catchTypes: [] as readonly (abstract new (...args: readonly unknown[]) => Error)[] }],
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(globalFilter).toHaveBeenCalledTimes(1);
      const errorArg = globalFilter.mock.calls[0]![0];
      expect(errorArg).toBeInstanceOf(Error);
      expect((errorArg as Error).message).toBe('middleware crash');
    });

    it('should not call routeHandler.matchRoute when routeHandler is not set', async () => {
      // Arrange
      adapter.initializePipeline(createMockContainer());
      // Do NOT call setRouteHandler

      const context = createHttpContext('GET', '/test');

      // Act
      await adapter.dispatchRequest(context);

      // Assert — should get 500 "Router not initialized" written directly to response
      const http = context.to(HttpContext);
      expect(http.response.getStatus()).toBe(500);
    });
  });

  // ── Failure Propagation Paths ─────────────────────────────

  describe('failure propagation paths', () => {
    it('should route handler throw through exception filter and run OnComplete', async () => {
      // Arrange
      const order: string[] = [];

      const exceptionFilterHandler = (_error: unknown, _ctx: Context) => {
        order.push('exceptionFilter');
        return err({ caught: true });
      };

      adapter.addMiddlewares(HttpPhase.OnRequest, [defineMiddleware(() => () => { order.push('OnReceive'); })]);
      adapter.addMiddlewares(HttpPhase.AfterResponse, [defineMiddleware(() => () => { order.push('OnComplete'); })]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        pre: [
          () => { order.push('PostParse'); },
          () => { order.push('PreHandle'); },
        ],
        filters: [{ handler: exceptionFilterHandler, catchTypes: [] as readonly (abstract new (...args: readonly unknown[]) => Error)[] }],
        handler: () => { throw new Error('handler failed'); },
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('POST', '/test'));

      // Assert — pipeline runs up to handler, handler throws, exception filter catches, OnComplete runs
      expect(order).toEqual(['OnReceive', 'PostParse', 'PreHandle', 'exceptionFilter', 'OnComplete']);
    });

    it('should route global guard throw (not Err) to exception filters', async () => {
      // Arrange
      const filterHandler = mock((_error: unknown, _ctx: Context) => err({ caught: true }));

      adapter.initializePipeline(createMockContainer());

      const handlerFn = mock(() => 'ok');
      const routeHandler = createMockRouteHandler({
        pre: [() => { throw new Error('guard exploded'); }],
        filters: [{ handler: filterHandler, catchTypes: [] as readonly (abstract new (...args: readonly unknown[]) => Error)[] }],
        handler: handlerFn,
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(filterHandler).toHaveBeenCalledTimes(1);
      expect((filterHandler.mock.calls[0]![0] as Error).message).toBe('guard exploded');
      expect(handlerFn).not.toHaveBeenCalled();
    });

    it('should run first MW then route to exception filter when second MW throws', async () => {
      // Arrange
      const order: string[] = [];
      const thirdMw = mock((_ctx: Context) => { order.push('mw3'); });

      const routeFilterHandler = mock((_error: unknown, _ctx: Context) => {
        order.push('route:filter');
        return err({ caught: true });
      });

      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        pre: [
          () => { order.push('mw1'); },
          () => { order.push('mw2:throw'); throw new Error('mw2 crash'); },
          thirdMw,
        ],
        filters: [{ handler: routeFilterHandler, catchTypes: [] }],
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(order).toEqual(['mw1', 'mw2:throw', 'route:filter']);
      expect(thirdMw).not.toHaveBeenCalled();
    });

    it('should call emergencyTeardown when route exception filter itself throws', async () => {
      // Arrange
      adapter.initializePipeline(createMockContainer());
      (adapter as any).emergencyTeardown = mock(() => {});

      const routeHandler = createMockRouteHandler({
        filters: [{
          handler: () => { throw new Error('filter also crashed'); },
          catchTypes: [],
        }],
        handler: () => { throw new Error('handler crash'); },
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert — filter throw propagates out of runPipeline → dispatchRequest catches → emergencyTeardown
      expect((adapter as any).emergencyTeardown).toHaveBeenCalledTimes(1);
    });

    it('should trigger emergencyTeardown when route exception filter throws (filter error propagates)', async () => {
      // Arrange
      adapter.initializePipeline(createMockContainer());
      (adapter as any).emergencyTeardown = mock(() => {});

      const routeHandler = createMockRouteHandler({
        filters: [{
          handler: () => { throw new Error('filter crash'); },
          catchTypes: [],
        }],
        handler: () => { throw new Error('handler crash'); },
      });
      adapter.setRouteHandler(routeHandler as never);

      const context = createHttpContext('GET', '/test');

      // Act
      await adapter.dispatchRequest(context);

      // Assert — filter throw propagates out of runPipeline, dispatchRequest catches → emergencyTeardown
      expect((adapter as any).emergencyTeardown).toHaveBeenCalledTimes(1);
      const errorArg = (adapter as any).emergencyTeardown.mock.calls[0]![1];
      expect(errorArg).toBeInstanceOf(Error);
      expect((errorArg as Error).message).toBe('filter crash');
    });

    it('should call emergencyTeardown when post step throws', async () => {
      // Arrange
      adapter.initializePipeline(createMockContainer());
      (adapter as any).emergencyTeardown = mock(() => {});

      const mockRouteHandler = {
        matchRoute: mock(() => ({
          kind: 'matched',
          params: {},
          route: {
            handler: () => { throw new Error('handler crash'); },
            rawBody: false,
            sse: false,
            bodyLimit: undefined,
            status: undefined,
            redirect: undefined,
            contentType: undefined,
            headers: [],
            pre: [],
            post: [() => { throw new Error('post step broken'); }],
            filters: [],
            validations: [],
          },
        })),
      };
      adapter.setRouteHandler(mockRouteHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect((adapter as any).emergencyTeardown).toHaveBeenCalledTimes(1);
    });

    it('should not affect request result when OnComplete middleware throws', async () => {
      // Arrange
      adapter.addMiddlewares(HttpPhase.AfterResponse, [
        defineMiddleware(() => () => { throw new Error('OnComplete crash'); }),
      ]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        handler: () => ({ success: true }),
      });
      adapter.setRouteHandler(routeHandler as never);

      const context = createHttpContext('GET', '/test');

      // Act — should not throw despite OnComplete failure
      await expect(adapter.dispatchRequest(context)).resolves.toBeUndefined();

      // Assert — handler result stored on context before OnComplete ran
      const receivedResult = context.get(handlerResultKey);
      expect(isErr(receivedResult)).toBe(false);
    });

    it('should not affect request result when OnComplete middleware returns Err', async () => {
      // Arrange
      adapter.addMiddlewares(HttpPhase.AfterResponse, [
        defineMiddleware(() => () => err({ reason: 'OnComplete err' })),
      ]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        handler: () => ({ success: true }),
      });
      adapter.setRouteHandler(routeHandler as never);

      const context = createHttpContext('GET', '/test');

      // Act
      await expect(adapter.dispatchRequest(context)).resolves.toBeUndefined();

      // Assert — handler result still stored on context normally
      const receivedResult = context.get(handlerResultKey);
      expect(isErr(receivedResult)).toBe(false);
    });
  });

  // ── Exception Filter Priority ──────────────────────────────

  describe('exception filter priority', () => {
    it('should prefer route-level catch-all over global specific filter', async () => {
      // Arrange
      class SpecificError extends Error {
        constructor() { super('specific'); }
      }

      const globalSpecificHandler = mock((_error: unknown, _ctx: Context) => err({ source: 'global-specific' }));
      const routeCatchAllHandler = mock((_error: unknown, _ctx: Context) => err({ source: 'route-catch-all' }));

      adapter.addExceptionFilters([defineExceptionFilter([SpecificError], () => globalSpecificHandler)]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        filters: [{ handler: routeCatchAllHandler, catchTypes: [] }],
        handler: () => { throw new SpecificError(); },
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert — route-level catch-all takes priority over global specific
      expect(routeCatchAllHandler).toHaveBeenCalledTimes(1);
      expect(globalSpecificHandler).not.toHaveBeenCalled();
    });

    it('should use first matching route-level filter when multiple registered', async () => {
      // Arrange
      class AppError extends Error {
        constructor() { super('app'); }
      }

      const order: string[] = [];
      const firstHandler = mock((_error: unknown, _ctx: Context) => { order.push('first'); return err({ matched: 'first' }); });
      const secondHandler = mock((_error: unknown, _ctx: Context) => { order.push('second'); return err({ matched: 'second' }); });

      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        filters: [
          { handler: firstHandler, catchTypes: [AppError] },
          { handler: secondHandler, catchTypes: [] },
        ],
        handler: () => { throw new AppError(); },
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(order).toEqual(['first']);
      expect(secondHandler).not.toHaveBeenCalled();
    });

    it('should skip non-matching route filter and use next matching route filter before global', async () => {
      // Arrange
      class ErrorA extends Error {}
      class ErrorB extends Error {
        constructor() { super('B'); }
      }

      const filterA = mock((_error: unknown, _ctx: Context) => err({ source: 'A' }));
      const filterB = mock((_error: unknown, _ctx: Context) => err({ source: 'B' }));
      const globalFilter = mock((_error: unknown, _ctx: Context) => err({ source: 'global' }));

      adapter.addExceptionFilters([defineExceptionFilter([], () => globalFilter)]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        filters: [
          { handler: filterA, catchTypes: [ErrorA] },
          { handler: filterB, catchTypes: [ErrorB] },
        ],
        handler: () => { throw new ErrorB(); },
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert — ErrorA filter skipped, ErrorB filter matches
      expect(filterA).not.toHaveBeenCalled();
      expect(filterB).toHaveBeenCalledTimes(1);
      expect(globalFilter).not.toHaveBeenCalled();
    });
  });

  // ── Route-Level Middleware Err Does Not Trigger Exception Filters ──

  describe('Err vs throw distinction', () => {
    it('should not register route exception filters when route MW Err halts before route matching sets them', async () => {
      // This tests an important subtlety: route exception filters are set in resolveRoute
      // AFTER route match but BEFORE route MW execution. So if route MW returns Err,
      // the Err flows back as a normal Result, never touching exception filters.
      // But if route MW THROWS, it DOES go through exception filters (including route-level ones).

      const routeFilterHandler = mock((_error: unknown, _ctx: Context) => err({ source: 'route' }));
      const globalFilterHandler = mock((_error: unknown, _ctx: Context) => err({ source: 'global' }));

      adapter.addExceptionFilters([defineExceptionFilter([], () => globalFilterHandler)]);
      adapter.initializePipeline(createMockContainer());

      // Err path — should NOT trigger any exception filter
      const routeHandler = createMockRouteHandler({
        pre: [() => err({ status: 429 })],
        filters: [{ handler: routeFilterHandler, catchTypes: [] }],
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(routeFilterHandler).not.toHaveBeenCalled();
      expect(globalFilterHandler).not.toHaveBeenCalled();
    });

    it('should trigger route exception filter when route MW throws (not Err)', async () => {
      // Arrange
      const routeFilterHandler = mock((_error: unknown, _ctx: Context) => err({ source: 'route' }));
      const globalFilterHandler = mock((_error: unknown, _ctx: Context) => err({ source: 'global' }));

      adapter.addExceptionFilters([defineExceptionFilter([], () => globalFilterHandler)]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        pre: [() => { throw new Error('MW throw'); }],
        filters: [{ handler: routeFilterHandler, catchTypes: [] }],
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert — throw goes through exception filter chain, route catch-all matches
      expect(routeFilterHandler).toHaveBeenCalledTimes(1);
      expect(globalFilterHandler).not.toHaveBeenCalled();
    });

    it('should trigger route exception filter when handler throws (not Err)', async () => {
      // Arrange
      const routeFilterHandler = mock((_error: unknown, _ctx: Context) => err({ source: 'route' }));

      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        filters: [{ handler: routeFilterHandler, catchTypes: [] }],
        handler: () => { throw new Error('handler throw'); },
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(routeFilterHandler).toHaveBeenCalledTimes(1);
      expect((routeFilterHandler.mock.calls[0]![0] as Error).message).toBe('handler throw');
    });

    it('should NOT trigger exception filter when handler returns Err', async () => {
      // Arrange
      const routeFilterHandler = mock((_error: unknown, _ctx: Context) => err({ source: 'route' }));
      const globalFilterHandler = mock((_error: unknown, _ctx: Context) => err({ source: 'global' }));

      adapter.addExceptionFilters([defineExceptionFilter([], () => globalFilterHandler)]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        filters: [{ handler: routeFilterHandler, catchTypes: [] }],
        handler: () => err({ status: 400, message: 'bad input' }),
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert — Err is a normal Result, not an exception
      expect(routeFilterHandler).not.toHaveBeenCalled();
      expect(globalFilterHandler).not.toHaveBeenCalled();
    });

    it('should route to route-level exception filter when route guard throws', async () => {
      // Arrange — route exception filters are set in resolveRoute BEFORE guards run in executeHandler,
      // so a guard throw should be caught by route-level filters
      const routeFilterHandler = mock((_error: unknown, _ctx: Context) => err({ source: 'route-filter' }));
      const globalFilterHandler = mock((_error: unknown, _ctx: Context) => err({ source: 'global' }));

      adapter.addExceptionFilters([defineExceptionFilter([], () => globalFilterHandler)]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        pre: [() => { throw new Error('guard exploded'); }],
        filters: [{ handler: routeFilterHandler, catchTypes: [] }],
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert — route catch-all filter handles the guard throw
      expect(routeFilterHandler).toHaveBeenCalledTimes(1);
      expect((routeFilterHandler.mock.calls[0]![0] as Error).message).toBe('guard exploded');
      expect(globalFilterHandler).not.toHaveBeenCalled();
    });

    it('should treat non-void non-Err return from middleware as continue', async () => {
      // Arrange — runMiddlewares only checks isErr(); anything else = continue
      const order: string[] = [];

      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        pre: [
          () => { order.push('mw1'); return 'garbage string' as never; },
          () => { order.push('mw2'); return 42 as never; },
          () => { order.push('mw3'); return { random: 'object' } as never; },
        ],
        handler: () => { order.push('handler'); return 'ok'; },
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert — all middlewares ran, handler reached
      expect(order).toEqual(['mw1', 'mw2', 'mw3', 'handler']);
    });

    it('should treat null return from middleware as continue', async () => {
      // Arrange
      const handlerFn = mock(() => 'ok');

      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        pre: [() => null as never],
        handler: handlerFn,
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(handlerFn).toHaveBeenCalledTimes(1);
    });
  });

  // ── OnComplete Guarantee ────────────────────────────────────

  describe('OnComplete guarantee', () => {
    it('should run OnComplete on success path', async () => {
      // Arrange
      const onCompleteFn = mock((_ctx: Context) => {});

      adapter.addMiddlewares(HttpPhase.AfterResponse, [defineMiddleware(() => onCompleteFn)]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        handler: () => ({ data: 'success' }),
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(onCompleteFn).toHaveBeenCalledTimes(1);
    });

    it('should run OnComplete on Err path (middleware Err)', async () => {
      // Arrange
      const onCompleteFn = mock((_ctx: Context) => {});

      adapter.addMiddlewares(HttpPhase.AfterResponse, [defineMiddleware(() => onCompleteFn)]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        pre: [() => err({ halt: true })],
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(onCompleteFn).toHaveBeenCalledTimes(1);
    });

    it('should run OnComplete on exception path (handler throw)', async () => {
      // Arrange
      const onCompleteFn = mock((_ctx: Context) => {});

      adapter.addMiddlewares(HttpPhase.AfterResponse, [defineMiddleware(() => onCompleteFn)]);
      adapter.addExceptionFilters([defineExceptionFilter([], () => (_error, _ctx) => err({ caught: true }))]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        handler: () => { throw new Error('handler crash'); },
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(onCompleteFn).toHaveBeenCalledTimes(1);
    });

    it('should run OnComplete even when emergencyTeardown is called', async () => {
      // Arrange
      const onCompleteFn = mock((_ctx: Context) => {});

      adapter.addMiddlewares(HttpPhase.AfterResponse, [defineMiddleware(() => onCompleteFn)]);
      adapter.initializePipeline(createMockContainer());
      (adapter as any).emergencyTeardown = mock(() => {});

      const mockRouteHandler = {
        matchRoute: mock(() => ({
          kind: 'matched',
          params: {},
          route: {
            handler: () => ({ data: 'ok' }),
            rawBody: false,
            sse: false,
            bodyLimit: undefined,
            status: undefined,
            redirect: undefined,
            contentType: undefined,
            headers: [],
            pre: [],
            post: [() => { throw new Error('post step broken'); }],
            filters: [],
            validations: [],
          },
        })),
      };
      adapter.setRouteHandler(mockRouteHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect((adapter as any).emergencyTeardown).toHaveBeenCalledTimes(1);
      expect(onCompleteFn).toHaveBeenCalledTimes(1);
    });
  });

  // ── No Route Exception Filter Fallback ────────────────────

  describe('no route exception filter fallback', () => {
    it('should use merged filter chain including global filter when route registers it', async () => {
      // Arrange
      const globalFilter = mock((_error: unknown, _ctx: Context) => err({ source: 'global' }));

      adapter.initializePipeline(createMockContainer());

      // In the new pipeline, global filters are merged into route.filters at boot time
      const routeHandler = createMockRouteHandler({
        filters: [{ handler: globalFilter, catchTypes: [] as readonly (abstract new (...args: readonly unknown[]) => Error)[] }],
        handler: () => { throw new Error('handler crash'); },
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert — filter chain includes global filter
      expect(globalFilter).toHaveBeenCalledTimes(1);
      expect((globalFilter.mock.calls[0]![0] as Error).message).toBe('handler crash');
    });

    it('should produce typed ErrorResponseData 500 when no filter matches an unhandled throw', async () => {
      // HttpAdapter overrides executeExceptionFilterChain so that unhandled
      // throws surface as `ErrorResponseData` (generic 500) — core's generic
      // `{message:'Unhandled error', cause}` shape is not HTTP-renderable.
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        filters: [],
        handler: () => { throw new Error('totally unhandled'); },
      });
      adapter.setRouteHandler(routeHandler as never);

      const context = createHttpContext('GET', '/test');

      await adapter.dispatchRequest(context);

      const receivedResult = context.get(handlerResultKey);
      expect(isErr(receivedResult)).toBe(true);
      const data = (receivedResult as { data: Record<string, unknown> }).data;
      expect(data.status).toBe(500);
      expect(data.message).toBe('Internal Server Error');
      expect('cause' in data).toBe(false);
    });
  });

  // ── applyMiddlewareConfig validation ─────────────────────────

  describe('applyMiddlewareConfig', () => {
    it('should throw when given an invalid phase key', () => {
      // Arrange
      const adapter = new HttpAdapter();
      const invalidConfig = { InvalidPhase: [defineMiddleware(() => () => {})] };

      // Act & Assert
      expect(() => adapter.applyMiddlewareConfig(invalidConfig)).toThrow(/Invalid middleware phase 'InvalidPhase'/);
    });

    it('should accept all valid HttpPhase keys', () => {
      // Arrange
      const adapter = new HttpAdapter();
      const mw = defineMiddleware(() => () => {});

      // Act & Assert — should not throw
      expect(() => adapter.applyMiddlewareConfig({
        OnRequest: [mw],
        BeforeParse: [mw],
        BeforeValidate: [mw],
        BeforeHandle: [mw],
        AfterHandle: [mw],
        BeforeResponse: [mw],
        AfterResponse: [mw],
      })).not.toThrow();
    });

    it('should accumulate definitions when called multiple times for the same phase', () => {
      // Arrange
      const adapter = new HttpAdapter();
      const mw1 = defineMiddleware(() => () => {});
      const mw2 = defineMiddleware(() => () => {});

      // Act
      adapter.applyMiddlewareConfig({ OnRequest: [mw1] });
      adapter.applyMiddlewareConfig({ OnRequest: [mw2] });
      adapter.initializePipeline(createMockContainer());

      // Assert — both middlewares should be registered
      const registry = (adapter as any).resolvedMiddlewareRegistry as Map<string, unknown[]>;
      expect(registry.get('OnRequest')).toHaveLength(2);
    });
  });

  // ── parseBody ──────────────────────────────────────────────────

  describe('parseBody', () => {
    const { parseBody } = require('./body');
    const DEFAULT_BODY_LIMIT = 10 * 1024 * 1024;
    const EMPTY_TEXT_MEDIA_TYPES = new Set<string>();
    it('should parse JSON body for POST request with application/json content-type', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      adapter.initializePipeline(createMockContainer());

      const jsonBody = JSON.stringify({ name: 'test' });
      const rawRequest = new Request('http://localhost/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: jsonBody,
      });

      const req = createStubHttpRequest({
        method: 'POST',
        originalMethod: 'POST',
        headers: new Headers({ 'content-type': 'application/json' }),
      }) as InstanceType<typeof HttpRequest>;
      const res = new HttpResponse(req, new Headers());
      const http = new HttpContext(req, res, rawRequest);

      // Act
      await parseBody(http, DEFAULT_BODY_LIMIT, EMPTY_TEXT_MEDIA_TYPES);

      // Assert
      expect(req.body).toEqual({ name: 'test' });
    });

    it('should parse text body for POST request without JSON content-type', async () => {
      // Arrange
      const rawRequest = new Request('http://localhost/test', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: 'hello world',
      });

      const req = createStubHttpRequest({
        method: 'POST',
        originalMethod: 'POST',
        headers: new Headers({ 'content-type': 'text/plain' }),
      }) as InstanceType<typeof HttpRequest>;
      const res = new HttpResponse(req, new Headers());
      const http = new HttpContext(req, res, rawRequest);

      // Act
      await parseBody(http, DEFAULT_BODY_LIMIT, EMPTY_TEXT_MEDIA_TYPES);

      // Assert
      expect(req.body).toBe('hello world');
    });

    it('should return Err with 400 status for invalid JSON', async () => {
      // Arrange
      const rawRequest = new Request('http://localhost/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{invalid json',
      });

      const req = createStubHttpRequest({
        method: 'POST',
        originalMethod: 'POST',
        headers: new Headers({ 'content-type': 'application/json' }),
      }) as InstanceType<typeof HttpRequest>;
      const res = new HttpResponse(req, new Headers());
      const http = new HttpContext(req, res, rawRequest);

      // Act
      const result = await parseBody(http, DEFAULT_BODY_LIMIT, EMPTY_TEXT_MEDIA_TYPES);

      // Assert
      expect(isErr(result)).toBe(true);
      expect(result.data).toEqual({ status: 400, message: 'Invalid JSON in request body' });
    });

    it('should skip body parsing for GET requests', async () => {
      // Arrange
      const rawRequest = new Request('http://localhost/test');

      const req = createStubHttpRequest({
        method: 'GET',
        originalMethod: 'GET',
      }) as InstanceType<typeof HttpRequest>;
      const res = new HttpResponse(req, new Headers());
      const http = new HttpContext(req, res, rawRequest);

      // Act
      await parseBody(http, DEFAULT_BODY_LIMIT, EMPTY_TEXT_MEDIA_TYPES);

      // Assert — body should remain at its initial value (undefined)
      expect(req.body).toBeUndefined();
    });

    it('should skip body parsing for HEAD requests', async () => {
      // Arrange

      const req = createStubHttpRequest({
        method: 'HEAD',
        originalMethod: 'HEAD',
      }) as InstanceType<typeof HttpRequest>;
      const res = new HttpResponse(req, new Headers());
      const http = new HttpContext(req, res, new Request('http://localhost/test', { method: 'HEAD' }));

      // Act
      await parseBody(http, DEFAULT_BODY_LIMIT, EMPTY_TEXT_MEDIA_TYPES);

      // Assert
      expect(req.body).toBeUndefined();
    });

    it('should skip body parsing for DELETE requests', async () => {
      // Arrange

      const req = createStubHttpRequest({
        method: 'DELETE',
        originalMethod: 'DELETE',
      }) as InstanceType<typeof HttpRequest>;
      const res = new HttpResponse(req, new Headers());
      const http = new HttpContext(req, res, new Request('http://localhost/test', { method: 'DELETE' }));

      // Act
      await parseBody(http, DEFAULT_BODY_LIMIT, EMPTY_TEXT_MEDIA_TYPES);

      // Assert
      expect(req.body).toBeUndefined();
    });

    it('should skip body parsing for OPTIONS requests', async () => {
      // Arrange

      const req = createStubHttpRequest({
        method: 'OPTIONS',
        originalMethod: 'OPTIONS',
      }) as InstanceType<typeof HttpRequest>;
      const res = new HttpResponse(req, new Headers());
      const http = new HttpContext(req, res, new Request('http://localhost/test', { method: 'OPTIONS' }));

      // Act
      await parseBody(http, DEFAULT_BODY_LIMIT, EMPTY_TEXT_MEDIA_TYPES);

      // Assert
      expect(req.body).toBeUndefined();
    });

    it('should skip body parsing when rawRequest is undefined', async () => {
      // Arrange

      const req = createStubHttpRequest({
        method: 'POST',
        originalMethod: 'POST',
        headers: new Headers({ 'content-type': 'application/json' }),
      }) as InstanceType<typeof HttpRequest>;
      const res = new HttpResponse(req, new Headers());
      const http = new HttpContext(req, res); // no rawRequest

      // Act
      await parseBody(http, DEFAULT_BODY_LIMIT, EMPTY_TEXT_MEDIA_TYPES);

      // Assert
      expect(req.body).toBeUndefined();
    });

    // ── Content-Encoding rejection ────────────────────────────────

    it('should return 415 error when Content-Encoding is not identity', async () => {
      // Arrange
      const rawRequest = new Request('http://localhost/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
        body: JSON.stringify({ data: 'compressed' }),
      });

      const req = createStubHttpRequest({
        method: 'POST',
        originalMethod: 'POST',
        headers: new Headers({ 'content-type': 'application/json', 'content-encoding': 'gzip' }),
        contentLength: 30,
      }) as InstanceType<typeof HttpRequest>;
      const res = new HttpResponse(req, new Headers());
      const http = new HttpContext(req, res, rawRequest);

      // Act
      const result = await parseBody(http, DEFAULT_BODY_LIMIT, EMPTY_TEXT_MEDIA_TYPES);

      // Assert
      expect(isErr(result)).toBe(true);
      expect(result.data.status).toBe(415);
      expect(result.data.message).toContain('Content-Encoding');
      expect(http.response.getHeader('accept-encoding')).toBe('identity');
    });

    // ── JSON charset validation ───────────────────────────────────

    it('should return 400 error when JSON body has non-UTF-8 charset', async () => {
      // Arrange
      const rawRequest = new Request('http://localhost/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=iso-8859-1' },
        body: JSON.stringify({ name: 'test' }),
      });

      const req = createStubHttpRequest({
        method: 'POST',
        originalMethod: 'POST',
        headers: new Headers({ 'content-type': 'application/json; charset=iso-8859-1' }),
      }) as InstanceType<typeof HttpRequest>;
      const res = new HttpResponse(req, new Headers());
      const http = new HttpContext(req, res, rawRequest);

      // Act
      const result = await parseBody(http, DEFAULT_BODY_LIMIT, EMPTY_TEXT_MEDIA_TYPES);

      // Assert
      expect(isErr(result)).toBe(true);
      expect(result.data.status).toBe(400);
      expect(result.data.message).toContain('UTF-8');
    });

    it('should accept JSON body with UTF-8 charset', async () => {
      // Arrange
      const rawRequest = new Request('http://localhost/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ accepted: true }),
      });

      const req = createStubHttpRequest({
        method: 'POST',
        originalMethod: 'POST',
        headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
      }) as InstanceType<typeof HttpRequest>;
      const res = new HttpResponse(req, new Headers());
      const http = new HttpContext(req, res, rawRequest);

      // Act
      await parseBody(http, DEFAULT_BODY_LIMIT, EMPTY_TEXT_MEDIA_TYPES);

      // Assert
      expect(req.body).toEqual({ accepted: true });
    });

    // ── DELETE/OPTIONS with content-type ───────────────────────────

    it('should parse body when DELETE request has content-type', async () => {
      // Arrange
      const jsonBody = JSON.stringify({ id: 42 });
      const rawRequest = new Request('http://localhost/test', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: jsonBody,
      });

      const req = createStubHttpRequest({
        method: 'DELETE',
        originalMethod: 'DELETE',
        headers: new Headers({ 'content-type': 'application/json' }),
      }) as InstanceType<typeof HttpRequest>;
      const res = new HttpResponse(req, new Headers());
      const http = new HttpContext(req, res, rawRequest);

      // Act
      await parseBody(http, DEFAULT_BODY_LIMIT, EMPTY_TEXT_MEDIA_TYPES);

      // Assert
      expect(req.body).toEqual({ id: 42 });
    });

    // ── Content-Length: 0 ─────────────────────────────────────────

    it('should skip body parsing when Content-Length is 0', async () => {
      // Arrange
      const rawRequest = new Request('http://localhost/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': '0' },
      });

      const req = createStubHttpRequest({
        method: 'POST',
        originalMethod: 'POST',
        headers: new Headers({ 'content-type': 'application/json', 'content-length': '0' }),
        contentLength: 0,
      }) as InstanceType<typeof HttpRequest>;
      const res = new HttpResponse(req, new Headers());
      const http = new HttpContext(req, res, rawRequest);

      // Act
      const result = await parseBody(http, DEFAULT_BODY_LIMIT, EMPTY_TEXT_MEDIA_TYPES);

      // Assert
      expect(result).toBeUndefined();
      expect(req.body).toBeUndefined();
    });

    // ── rawBody enabled ───────────────────────────────────────────

    it('should set rawBody when rawBody is enabled on matched route', async () => {
      // Arrange
      const jsonPayload = JSON.stringify({ webhook: 'data' });
      const rawRequest = new Request('http://localhost/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: jsonPayload,
      });

      const req = createStubHttpRequest({
        method: 'POST',
        originalMethod: 'POST',
        headers: new Headers({ 'content-type': 'application/json' }),
      }) as InstanceType<typeof HttpRequest>;
      const res = new HttpResponse(req, new Headers());
      const http = new HttpContext(req, res, rawRequest);

      http.matchedRoute = {
        rawBody: true,
        sse: false,
        bodyLimit: undefined,
        status: undefined,
        redirect: undefined,
        contentType: undefined,
        headers: [],
        pre: [],
        post: [],
        filters: [],
        handler: mock(() => ({})),
        validations: [],
      };

      // Act
      await parseBody(http, DEFAULT_BODY_LIMIT, EMPTY_TEXT_MEDIA_TYPES);

      // Assert
      expect(req.rawBody).toBeInstanceOf(Uint8Array);
      expect(req.rawBody!.byteLength).toBeGreaterThan(0);
      expect(req.body).toEqual({ webhook: 'data' });
    });

    // ── Streaming body ────────────────────────────────────────────

    it('should assign ReadableStream to body for non-bufferable content types', async () => {
      // Arrange
      const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
      const rawRequest = new Request('http://localhost/test', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: binaryData,
      });

      const req = createStubHttpRequest({
        method: 'POST',
        originalMethod: 'POST',
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
      }) as InstanceType<typeof HttpRequest>;
      const res = new HttpResponse(req, new Headers());
      const http = new HttpContext(req, res, rawRequest);

      // Act
      await parseBody(http, DEFAULT_BODY_LIMIT, EMPTY_TEXT_MEDIA_TYPES);

      // Assert
      expect(req.body).toBeInstanceOf(ReadableStream);
    });

    // ── JSON +json suffix ─────────────────────────────────────────

    it('should parse body as JSON for +json content types', async () => {
      // Arrange
      const jsonPayload = JSON.stringify({ type: 'articles', id: '1' });
      const rawRequest = new Request('http://localhost/test', {
        method: 'POST',
        headers: { 'content-type': 'application/vnd.api+json' },
        body: jsonPayload,
      });

      const req = createStubHttpRequest({
        method: 'POST',
        originalMethod: 'POST',
        headers: new Headers({ 'content-type': 'application/vnd.api+json' }),
      }) as InstanceType<typeof HttpRequest>;
      const res = new HttpResponse(req, new Headers());
      const http = new HttpContext(req, res, rawRequest);

      // Act
      await parseBody(http, DEFAULT_BODY_LIMIT, EMPTY_TEXT_MEDIA_TYPES);

      // Assert
      expect(req.body).toEqual({ type: 'articles', id: '1' });
    });

    // ── SyntaxError vs infrastructure error ───────────────────────

    it('should rethrow non-SyntaxError from json parsing', async () => {
      // Arrange

      const req = createStubHttpRequest({
        method: 'POST',
        originalMethod: 'POST',
        headers: new Headers({ 'content-type': 'application/json' }),
      }) as InstanceType<typeof HttpRequest>;
      const res = new HttpResponse(req, new Headers());

      // Create a Request whose body has already been consumed so rawReq.json() throws TypeError
      const consumedRequest = new Request('http://localhost/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: 'valid' }),
      });
      // Consume the body first so subsequent .json() throws TypeError
      await consumedRequest.json();

      const http = new HttpContext(req, res, consumedRequest);

      // Act & Assert
      await expect(parseBody(http, DEFAULT_BODY_LIMIT, EMPTY_TEXT_MEDIA_TYPES)).rejects.toBeInstanceOf(TypeError);
    });
  });

  // ── WriteResponse (response writing) ──────────────────────────

  describe('WriteResponse', () => {
    it('should skip response when already sent', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const context = createHttpContext('GET', '/test');
      const http = context.to(HttpContext);
      const res = http.response;
      res.setStatus(200);
      res.setBody('already done');
      res.end();

      // Act — should not throw even with weird result
      await writeResult(adapter, { value: 'ignored' } as never, context);

      // Assert — response was already sent, status unchanged
      expect(res.isSent()).toBe(true);
    });

    it('should write error response for Err result with status', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const context = createHttpContext('GET', '/test');
      const http = context.to(HttpContext);

      // Act
      await writeResult(adapter, err({ status: 404, message: 'Not Found' }), context);

      // Assert
      const res = http.response;
      expect(res.getStatus()).toBe(404);
    });

    it('should write error response for httpError() factory value', async () => {
      // Arrange
      const { httpError } = require('./http-error');
      const adapter = new HttpAdapter();
      const context = createHttpContext('GET', '/test');
      const http = context.to(HttpContext);

      // Act
      await writeResult(adapter, httpError(403, 'Forbidden'), context);

      // Assert
      expect(http.response.getStatus()).toBe(403);
    });

    // Removed: previously asserted defensive fall-through when middleware returned
    // err('some string error'). That defensive coercion was deleted intentionally —
    // middleware authors are now responsible for returning ErrorResponseData via
    // the httpError() factory. The prior behavior was a runtime validator the
    // project does not want.

    it('should write success response for non-Err result', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const context = createHttpContext('GET', '/test');
      const http = context.to(HttpContext);

      // Act — writeResult now includes serialize step
      await writeResult(adapter, { data: 'success' } as never, context);

      // Assert — body is serialized to JSON string after serialize()
      const body = http.response.getBody();
      expect(body).toBe('{"data":"success"}');
    });

    it('should handle null result without error', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const context = createHttpContext('GET', '/test');

      // Act & Assert — should not throw
      await expect(writeResult(adapter, null as never, context)).resolves.toBeUndefined();
    });

    it('should handle undefined result without error', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const context = createHttpContext('GET', '/test');

      // Act & Assert
      await expect(writeResult(adapter, undefined as never, context)).resolves.toBeUndefined();
    });
  });

  // ── SSE AbortSignal ─────────────────────────────────────────

  describe('SSE AbortSignal', () => {
    it('should stop SSE stream when signal is aborted before iteration starts', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const controller = new AbortController();
      controller.abort();

      const yieldFn = mock(() => ({ event: 'tick' }));
      async function* sseStream() {
        yield yieldFn();
      }

      const context = createHttpContextWithSignal('GET', '/sse', controller.signal);
      setSseRoute(context);
      const http = context.to(HttpContext);

      // Act
      await writeResult(adapter, sseStream(), context);

      // Assert — signal was already aborted, iterator should never yield
      expect(yieldFn).not.toHaveBeenCalled();
      const nativeResponse = http.response.getNativeResponse();
      expect(nativeResponse).toBeInstanceOf(Response);
      expect(nativeResponse!.headers.get('content-type')).toBe('text/event-stream');

      // Drain the stream to verify it closes immediately
      const reader = nativeResponse!.body!.getReader();
      const { done } = await reader.read();
      expect(done).toBe(true);
    });

    it('should stop SSE stream when signal is aborted mid-iteration', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const controller = new AbortController();

      const yielded: number[] = [];
      async function* sseStream() {
        yielded.push(1);
        yield { chunk: 1 };
        controller.abort();
        yielded.push(2);
        yield { chunk: 2 };
        yielded.push(3);
        yield { chunk: 3 };
      }

      const context = createHttpContextWithSignal('GET', '/sse', controller.signal);
      setSseRoute(context);
      const http = context.to(HttpContext);

      // Act
      await writeResult(adapter, sseStream(), context);

      // Assert
      const nativeResponse = http.response.getNativeResponse();
      expect(nativeResponse).toBeInstanceOf(Response);

      // Drain the stream to collect chunks
      const reader = nativeResponse!.body!.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // First chunk emitted, second chunk triggers abort check on next pull
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      // Stream should have closed before all 3 chunks were emitted
      expect(chunks.length).toBeLessThan(3);
    });

    it('should call iterator.return() when ReadableStream is cancelled', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const controller = new AbortController();

      const returnFn = mock(() => Promise.resolve({ done: true as const, value: undefined }));
      const asyncIterable: AsyncIterable<unknown> = {
        [Symbol.asyncIterator]() {
          let callCount = 0;
          return {
            next() {
              callCount++;
              if (callCount <= 10) {
                return Promise.resolve({ done: false as const, value: { tick: callCount } });
              }
              return Promise.resolve({ done: true as const, value: undefined });
            },
            return: returnFn,
          };
        },
      };

      const context = createHttpContextWithSignal('GET', '/sse', controller.signal);
      setSseRoute(context);
      const http = context.to(HttpContext);

      // Act
      await writeResult(adapter, asyncIterable, context);

      const nativeResponse = http.response.getNativeResponse();
      expect(nativeResponse).toBeInstanceOf(Response);

      // Read one chunk then cancel
      const reader = nativeResponse!.body!.getReader();
      await reader.read();
      await reader.cancel();

      // Assert — iterator.return() called on cancel
      expect(returnFn).toHaveBeenCalledTimes(1);
    });

    it('should call controller.error when iterator throws and signal is not aborted', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const controller = new AbortController();

      const iteratorError = new Error('stream failed');
      async function* failingStream() {
        yield { first: true };
        throw iteratorError;
      }

      const context = createHttpContextWithSignal('GET', '/sse', controller.signal);
      setSseRoute(context);
      const http = context.to(HttpContext);

      // Act
      await writeResult(adapter, failingStream(), context);

      // Assert — stream should error, not close gracefully
      const nativeResponse = http.response.getNativeResponse();
      expect(nativeResponse).toBeInstanceOf(Response);

      const reader = nativeResponse!.body!.getReader();
      // First chunk should succeed
      const firstRead = await reader.read();
      expect(firstRead.done).toBe(false);

      // Second read should reject with the iterator error
      await expect(reader.read()).rejects.toThrow('stream failed');
    });

    it('should call controller.close when iterator throws and signal IS aborted', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const controller = new AbortController();

      const iteratorError = new Error('stream failed after abort');
      async function* failingAfterAbort() {
        yield { first: true };
        controller.abort();
        throw iteratorError;
      }

      const context = createHttpContextWithSignal('GET', '/sse', controller.signal);
      setSseRoute(context);
      const http = context.to(HttpContext);

      // Act
      await writeResult(adapter, failingAfterAbort(), context);

      // Assert — stream should close gracefully (not error) since signal is aborted
      const nativeResponse = http.response.getNativeResponse();
      expect(nativeResponse).toBeInstanceOf(Response);

      const reader = nativeResponse!.body!.getReader();
      // First chunk should succeed
      const firstRead = await reader.read();
      expect(firstRead.done).toBe(false);

      // Second read should indicate done (graceful close), not reject
      const secondRead = await reader.read();
      expect(secondRead.done).toBe(true);
    });

    it('should call ctx.setTimeout(0) on entering SSE branch (Bun-recommended pattern)', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const rawRequest = new Request('http://localhost/sse');
      const timeoutSpy = mock((_req: Request, _seconds: number) => undefined);
      const server = { timeout: timeoutSpy } as unknown as import('bun').Server<unknown>;
      const httpReq = new HttpRequest({
        requestId: 'sse-id',
        originalMethod: 'GET',
        originalUrl: 'http://localhost/sse',
        method: 'GET',
        url: 'http://localhost/sse',
        path: '/sse',
        headers: new Headers(),
        origin: { urlProtocol: 'http', urlHost: 'localhost' },
        contentLength: null,
        ip: null,
        ips: [],
        isTrustedProxy: false,
        signal: new AbortController().signal,
      });
      const httpRes = new HttpResponse(httpReq);
      const context = new HttpContext(httpReq, httpRes, rawRequest, undefined, server);
      setSseRoute(context);

      async function* sseStream() {
        yield { event: 'ready' };
      }

      // Act
      await writeResult(adapter, sseStream(), context);

      // Assert
      expect(timeoutSpy).toHaveBeenCalledTimes(1);
      expect(timeoutSpy.mock.calls[0]![0]).toBe(rawRequest);
      expect(timeoutSpy.mock.calls[0]![1]).toBe(0);
    });
  });

  // ── SSE backpressure ──────────────────────────────────────────

  describe('SSE backpressure', () => {
    it('should use pull-based streaming where iterator advances only as consumer reads', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const controller = new AbortController();

      let nextCallCount = 0;
      const asyncIterable: AsyncIterable<unknown> = {
        [Symbol.asyncIterator]() {
          return {
            next() {
              nextCallCount++;
              if (nextCallCount <= 5) {
                return Promise.resolve({ done: false as const, value: { tick: nextCallCount } });
              }
              return Promise.resolve({ done: true as const, value: undefined });
            },
          };
        },
      };

      const context = createHttpContextWithSignal('GET', '/sse', controller.signal);
      setSseRoute(context);
      const http = context.to(HttpContext);

      // Act
      await writeResult(adapter, asyncIterable, context);

      // Assert — pull-based: the stream does not eagerly consume all items.
      // After writeResult returns, the iterator should NOT have been fully drained.
      const nativeResponse = http.response.getNativeResponse();
      expect(nativeResponse).toBeInstanceOf(Response);

      // ReadableStream may eagerly pull once to fill its buffer, but should NOT
      // have consumed all 5 items before we start reading.
      expect(nextCallCount).toBeLessThan(5);

      // Now read all items to verify the stream works end-to-end
      const reader = nativeResponse!.body!.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // All 5 items should have been emitted
      expect(chunks).toHaveLength(5);
      // iterator.next() called 5 times for data + 1 final call returning done=true
      expect(nextCallCount).toBe(6);
    });

    it('should emit exactly one chunk per pull() call', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const controller = new AbortController();

      const chunks = ['alpha', 'beta', 'gamma'];
      let index = 0;
      const asyncIterable: AsyncIterable<unknown> = {
        [Symbol.asyncIterator]() {
          return {
            next() {
              if (index < chunks.length) {
                const value = chunks[index]!;
                index++;
                return Promise.resolve({ done: false as const, value });
              }
              return Promise.resolve({ done: true as const, value: undefined });
            },
          };
        },
      };

      const context = createHttpContextWithSignal('GET', '/sse', controller.signal);
      setSseRoute(context);
      const http = context.to(HttpContext);

      // Act
      await writeResult(adapter, asyncIterable, context);

      // Assert
      const nativeResponse = http.response.getNativeResponse();
      const reader = nativeResponse!.body!.getReader();
      const decoder = new TextDecoder();

      // Each read should produce exactly one SSE frame
      // formatSSEChunk passes string values directly to formatDataField (no JSON.stringify)
      const firstRead = await reader.read();
      expect(firstRead.done).toBe(false);
      const firstChunk = decoder.decode(firstRead.value);
      expect(firstChunk).toBe('data: alpha\n\n');

      const secondRead = await reader.read();
      expect(secondRead.done).toBe(false);
      const secondChunk = decoder.decode(secondRead.value);
      expect(secondChunk).toBe('data: beta\n\n');

      const thirdRead = await reader.read();
      expect(thirdRead.done).toBe(false);
      const thirdChunk = decoder.decode(thirdRead.value);
      expect(thirdChunk).toBe('data: gamma\n\n');

      // After all items consumed, stream should close
      const finalRead = await reader.read();
      expect(finalRead.done).toBe(true);
    });
  });

  // ── emergencyTeardown ────────────────────────────────────────

  describe('emergencyTeardown', () => {
    it('should set 500 status and Internal Server Error body', () => {
      // Arrange
      const adapter = new HttpAdapter();
      const context = createHttpContext('GET', '/test');
      const http = context.to(HttpContext);

      // Act
      (adapter as any).emergencyTeardown(context, new Error('crash'));

      // Assert
      expect(http.response.getStatus()).toBe(500);
      expect(http.response.getBody()).toBe('Internal Server Error');
    });

    it('should skip setting response when already sent', () => {
      // Arrange
      const adapter = new HttpAdapter();
      const context = createHttpContext('GET', '/test');
      const http = context.to(HttpContext);
      const res = http.response;
      res.setStatus(200);
      res.setBody('already sent');
      res.end();

      // Act
      (adapter as any).emergencyTeardown(context, new Error('crash'));

      // Assert — status should remain 200, not overwritten to 500
      expect(res.getStatus()).toBe(200);
    });
  });

  // ── validPhases ────────────────────────────────────────────────

  describe('validPhases', () => {
    it('should contain all HttpPhase values', () => {
      // Assert
      expect(HttpAdapter.validPhases).toContain('OnRequest');
      expect(HttpAdapter.validPhases).toContain('BeforeParse');
      expect(HttpAdapter.validPhases).toContain('BeforeValidate');
      expect(HttpAdapter.validPhases).toContain('BeforeHandle');
      expect(HttpAdapter.validPhases).toContain('AfterHandle');
      expect(HttpAdapter.validPhases).toContain('BeforeResponse');
      expect(HttpAdapter.validPhases).toContain('AfterResponse');
      expect(HttpAdapter.validPhases.size).toBe(7);
    });
  });

  // ── addMiddlewares convenience method ──────────────────────────

  describe('addMiddlewares', () => {
    it('should register middlewares for a given phase', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const order: string[] = [];

      adapter.addMiddlewares(HttpPhase.OnRequest, [defineMiddleware(() => () => { order.push('mw1'); })]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        handler: () => { order.push('handler'); return 'ok'; },
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(order).toEqual(['mw1', 'handler']);
    });

    it('should return this for chaining', () => {
      // Arrange
      const adapter = new HttpAdapter();

      // Act & Assert
      expect(adapter.addMiddlewares(HttpPhase.OnRequest, [])).toBe(adapter);
    });
  });

  // ── OPTIONS auto-Allow ────────────────────────────────────────

  describe('OPTIONS auto-Allow', () => {
    it('should return 204 with Allow header for OPTIONS request to path with registered methods', async () => {
      // Arrange
      adapter.initializePipeline(createMockContainer());

      const mockRouteHandler = {
        matchRoute: mock((method: string, _path: string) => {
          if (method === 'OPTIONS') {
            return { kind: 'method-not-allowed', allowedMethods: ['GET', 'HEAD', 'POST'] };
          }
          return { kind: 'not-found' };
        }),
      };
      adapter.setRouteHandler(mockRouteHandler as never);

      const context = createHttpContext('OPTIONS', '/test');

      // Act
      await adapter.dispatchRequest(context);

      // Assert
      const http = context.to(HttpContext);
      expect(http.response.getStatus()).toBe(204);
      expect(http.response.getHeader('allow')).toBe('GET, HEAD, POST');
    });

    it('should return 404 for OPTIONS request to path with no registered methods', async () => {
      // Arrange
      adapter.initializePipeline(createMockContainer());

      const noMatchRouteHandler = {
        matchRoute: mock(() => ({ kind: 'not-found' })),
      };
      adapter.setRouteHandler(noMatchRouteHandler as never);

      const context = createHttpContext('OPTIONS', '/nonexistent');

      // Act
      await adapter.dispatchRequest(context);

      // Assert — should get 404 written directly to response (pre-route error path)
      const http = context.to(HttpContext);
      expect(http.response.getStatus()).toBe(404);
    });

    it('should list all registered methods in Allow header', async () => {
      // Arrange
      adapter.initializePipeline(createMockContainer());

      const mockRouteHandler = {
        matchRoute: mock((method: string, _path: string) => {
          if (method === 'OPTIONS') {
            return { kind: 'method-not-allowed', allowedMethods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'] };
          }
          return { kind: 'not-found' };
        }),
      };
      adapter.setRouteHandler(mockRouteHandler as never);

      const context = createHttpContext('OPTIONS', '/resources');

      // Act
      await adapter.dispatchRequest(context);

      // Assert
      const http = context.to(HttpContext);
      expect(http.response.getHeader('allow')).toBe('GET, HEAD, POST, PUT, DELETE');
    });

    it('should short-circuit pipeline after OPTIONS auto-response', async () => {
      // Arrange
      const order: string[] = [];

      adapter.addMiddlewares(HttpPhase.BeforeParse, [defineMiddleware(() => () => { order.push('BeforeParse'); })]);
      adapter.addMiddlewares(HttpPhase.BeforeValidate, [defineMiddleware(() => () => { order.push('BeforeValidate'); })]);
      adapter.addMiddlewares(HttpPhase.BeforeHandle, [defineMiddleware(() => () => { order.push('BeforeHandle'); })]);
      adapter.addMiddlewares(HttpPhase.AfterResponse, [defineMiddleware(() => () => { order.push('AfterResponse'); })]);
      adapter.initializePipeline(createMockContainer());

      const mockRouteHandler = {
        matchRoute: mock((method: string, _path: string) => {
          if (method === 'OPTIONS') {
            return { kind: 'method-not-allowed', allowedMethods: ['GET', 'HEAD'] };
          }
          return { kind: 'not-found' };
        }),
      };
      adapter.setRouteHandler(mockRouteHandler as never);

      const context = createHttpContext('OPTIONS', '/test');

      // Act
      await adapter.dispatchRequest(context);

      // Assert — pipeline should short-circuit after resolveRoute sets isSent,
      // skipping BeforeParsing, BeforeValidation, BeforeHandler; Cleanup still runs
      expect(order).not.toContain('BeforeParse');
      expect(order).not.toContain('BeforeValidate');
      expect(order).not.toContain('BeforeHandle');
      expect(order).toContain('AfterResponse');
    });

    it('should use explicit OPTIONS handler instead of auto-response when registered', async () => {
      // Arrange
      const handlerFn = mock(() => ({ cors: 'custom' }));
      adapter.initializePipeline(createMockContainer());

      const mockRouteHandler = {
        matchRoute: mock(() => ({
          kind: 'matched',
          params: {},
          route: {
            handler: handlerFn,
            rawBody: false,
            sse: false,
            bodyLimit: undefined,
            status: undefined,
            redirect: undefined,
            contentType: undefined,
            headers: [],
            pre: [],
            post: [],
            filters: [],
            validations: [],
          },
        })),
      };
      adapter.setRouteHandler(mockRouteHandler as never);

      const context = createHttpContext('OPTIONS', '/test');

      // Act
      await adapter.dispatchRequest(context);

      // Assert — explicit handler should be called, not auto 204
      expect(handlerFn).toHaveBeenCalled();
      const http = context.to(HttpContext);
      expect(http.response.getStatus()).not.toBe(204);
    });
  });

  describe('RawBody decorator', () => {
    it('should return a function (MethodDecorator)', () => {
      // Arrange
      const { RawBody } = require('./decorators/method-option.decorator');

      // Act
      const decorator = RawBody();

      // Assert
      expect(typeof decorator).toBe('function');
    });

    it('should be a no-op when applied', () => {
      // Arrange
      const { RawBody } = require('./decorators/method-option.decorator');
      const decorator = RawBody();

      // Act & Assert — calling the decorator should not throw
      expect(() => decorator({}, 'method', {})).not.toThrow();
    });
  });

  describe('HttpAdapter.decorators', () => {
    it('should include RawBody in options', () => {
      // Arrange
      const adapter = new HttpAdapter();
      const { RawBody } = require('./decorators/method-option.decorator');

      // Assert
      expect(adapter.decorators.options).toBeDefined();
      expect(adapter.decorators.options).toContain(RawBody);
    });
  });

  describe('SSE edge cases', () => {
    it('should handle empty AsyncIterable gracefully', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const context = createHttpContext('GET', '/sse');
      setSseRoute(context);
      const http = context.to(HttpContext);

      async function* emptyGenerator() {
        // yields nothing
      }

      // Act
      await writeResult(adapter, emptyGenerator(), context);

      // Assert — native response should be SSE with no data chunks
      const nativeResponse = http.response.getNativeResponse();
      expect(nativeResponse).toBeInstanceOf(Response);
      expect(nativeResponse!.headers.get('content-type')).toBe('text/event-stream');

      // Drain the stream — should close immediately
      const reader = nativeResponse!.body!.getReader();
      const { done } = await reader.read();
      expect(done).toBe(true);
    });

    it('should propagate error when iterator throws on first iteration', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const context = createHttpContext('GET', '/sse');
      setSseRoute(context);
      const http = context.to(HttpContext);

      const failingIterable: AsyncIterable<unknown> = {
        [Symbol.asyncIterator]() {
          return { next: () => Promise.reject(new Error('iterator failed')) };
        },
      };

      // Act
      await writeResult(adapter, failingIterable, context);

      // Assert — native response should be set (SSE path)
      const nativeResponse = http.response.getNativeResponse();
      expect(nativeResponse).toBeInstanceOf(Response);

      // Read stream — should error
      const reader = nativeResponse!.body!.getReader();
      let errorCaught = false;

      try {
        await reader.read();
      } catch {
        errorCaught = true;
      }

      expect(errorCaught).toBe(true);
    });

    it('should handle iterator.return() throwing gracefully', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const controller = new AbortController();

      const asyncIterable: AsyncIterable<unknown> = {
        [Symbol.asyncIterator]() {
          let called = false;

          return {
            next() {
              if (!called) {
                called = true;

                return Promise.resolve({ done: false as const, value: { data: 'first' } });
              }

              return Promise.resolve({ done: true as const, value: undefined });
            },
            return() {
              throw new Error('return() exploded');
            },
          };
        },
      };

      const context = createHttpContextWithSignal('GET', '/sse', controller.signal);
      setSseRoute(context);
      const http = context.to(HttpContext);

      // Act
      await writeResult(adapter, asyncIterable, context);

      // Assert — native response should still be created
      const nativeResponse = http.response.getNativeResponse();
      expect(nativeResponse).toBeInstanceOf(Response);

      // Cancel the stream — should not throw despite iterator.return() throwing
      const reader = nativeResponse!.body!.getReader();
      await reader.read();
      await reader.cancel();
    });

    it('should handle signal abort during await iterator.next()', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const controller = new AbortController();

      const asyncIterable: AsyncIterable<unknown> = {
        [Symbol.asyncIterator]() {
          let count = 0;

          return {
            next() {
              count++;

              if (count === 1) {
                return Promise.resolve({ done: false as const, value: { tick: 1 } });
              }

              // Second call: abort during the await
              controller.abort();

              return Promise.resolve({ done: false as const, value: { tick: 2 } });
            },
          };
        },
      };

      const context = createHttpContextWithSignal('GET', '/sse', controller.signal);
      setSseRoute(context);
      const http = context.to(HttpContext);

      // Act
      await writeResult(adapter, asyncIterable, context);

      // Assert
      const nativeResponse = http.response.getNativeResponse();
      expect(nativeResponse).toBeInstanceOf(Response);

      const reader = nativeResponse!.body!.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // Should have at most 2 chunks (abort after second next())
      expect(chunks.length).toBeLessThanOrEqual(2);
    });
  });

  // ── emergencyTeardown Headers Preservation ────────────────────

  describe('emergencyTeardown headers preservation', () => {
    it('should preserve CORS headers set in OnRequest after emergencyTeardown', () => {
      // Arrange
      const adapter = new HttpAdapter();
      const context = createHttpContext('GET', '/test');
      const http = context.to(HttpContext);
      http.response.setHeader('access-control-allow-origin', '*');
      http.response.setHeader('access-control-allow-methods', 'GET, POST');

      // Act
      (adapter as any).emergencyTeardown(context, new Error('crash'));

      // Assert — CORS headers preserved
      expect(http.response.getHeader('access-control-allow-origin')).toBe('*');
      expect(http.response.getHeader('access-control-allow-methods')).toBe('GET, POST');
    });

    it('should set status to 500', () => {
      // Arrange
      const adapter = new HttpAdapter();
      const context = createHttpContext('GET', '/test');
      const http = context.to(HttpContext);

      // Act
      (adapter as any).emergencyTeardown(context, new Error('crash'));

      // Assert
      expect(http.response.getStatus()).toBe(500);
    });

    it('should set body to Internal Server Error', () => {
      // Arrange
      const adapter = new HttpAdapter();
      const context = createHttpContext('GET', '/test');
      const http = context.to(HttpContext);

      // Act
      (adapter as any).emergencyTeardown(context, new Error('crash'));

      // Assert
      expect(http.response.getBody()).toBe('Internal Server Error');
    });

    it('should NOT clear previous headers', () => {
      // Arrange
      const adapter = new HttpAdapter();
      const context = createHttpContext('GET', '/test');
      const http = context.to(HttpContext);
      http.response.setHeader('x-request-id', 'abc-123');
      http.response.setHeader('x-custom', 'preserved');

      // Act
      (adapter as any).emergencyTeardown(context, new Error('crash'));

      // Assert — previous headers are NOT cleared
      expect(http.response.getHeader('x-request-id')).toBe('abc-123');
      expect(http.response.getHeader('x-custom')).toBe('preserved');
    });
  });

  // ── pipelineError Integration ─────────────────────────────────

  describe('pipelineError integration', () => {
    let adapter: InstanceType<typeof HttpAdapter>;

    beforeEach(() => {
      adapter = new HttpAdapter();
    });

    it('should return error when pipelineError is set after OnRequest MW runs', async () => {
      // Arrange
      const order: string[] = [];

      adapter.addMiddlewares(HttpPhase.OnRequest, [defineMiddleware(() => (ctx) => {
        order.push('OnRequest');
        ctx.to(HttpContext).pipelineError = { status: 501, message: 'Not Implemented' };
      })]);
      adapter.initializePipeline(createMockContainer());

      const handlerFn = mock(() => 'ok');
      const routeHandler = createMockRouteHandler({ handler: handlerFn });
      adapter.setRouteHandler(routeHandler as never);

      const context = createHttpContext('GET', '/test');

      // Act
      await adapter.dispatchRequest(context);

      // Assert
      expect(order).toEqual(['OnRequest']);
      const http = context.to(HttpContext);
      expect(http.response.getStatus()).toBe(501);
      expect(handlerFn).not.toHaveBeenCalled();
    });

    it('should include OnRequest MW headers in pipelineError response', async () => {
      // Arrange
      adapter.addMiddlewares(HttpPhase.OnRequest, [defineMiddleware(() => (ctx) => {
        const http = ctx.to(HttpContext);
        http.response.setHeader('access-control-allow-origin', '*');
        http.pipelineError = { status: 400, message: 'Bad Request' };
      })]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({});
      adapter.setRouteHandler(routeHandler as never);

      const context = createHttpContext('GET', '/test');

      // Act
      await adapter.dispatchRequest(context);

      // Assert
      const http = context.to(HttpContext);
      expect(http.response.getHeader('access-control-allow-origin')).toBe('*');
      expect(http.response.getStatus()).toBe(400);
    });

    it('should return 501 status for pipelineError with 501', async () => {
      // Arrange
      adapter.addMiddlewares(HttpPhase.OnRequest, [defineMiddleware(() => (ctx) => {
        ctx.to(HttpContext).pipelineError = { status: 501, message: 'Not Implemented' };
      })]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({});
      adapter.setRouteHandler(routeHandler as never);

      const context = createHttpContext('GET', '/test');

      // Act
      await adapter.dispatchRequest(context);

      // Assert — pipelineError writes directly to response (pre-route error path)
      const http = context.to(HttpContext);
      expect(http.response.getStatus()).toBe(501);
    });

    it('should return 400 status for pipelineError with 400', async () => {
      // Arrange
      adapter.addMiddlewares(HttpPhase.OnRequest, [defineMiddleware(() => (ctx) => {
        ctx.to(HttpContext).pipelineError = { status: 400, message: 'Bad Request' };
      })]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({});
      adapter.setRouteHandler(routeHandler as never);

      const context = createHttpContext('GET', '/test');

      // Act
      await adapter.dispatchRequest(context);

      // Assert — pipelineError writes directly to response (pre-route error path)
      const http = context.to(HttpContext);
      expect(http.response.getStatus()).toBe(400);
    });

    it('should follow normal pipeline flow when no pipelineError is set', async () => {
      // Arrange
      const handlerFn = mock(() => ({ data: 'success' }));

      adapter.addMiddlewares(HttpPhase.OnRequest, [defineMiddleware(() => () => {
        // OnRequest MW runs but does NOT set pipelineError
      })]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({ handler: handlerFn });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(handlerFn).toHaveBeenCalledTimes(1);
    });
  });

  // ── Decorator Metadata Application ────────────────────────────

  describe('decorator metadata application', () => {
    let adapter: InstanceType<typeof HttpAdapter>;

    beforeEach(() => {
      adapter = new HttpAdapter();
      adapter.initializePipeline(createMockContainer());
    });

    it('should set default status via @Status decorator metadata', async () => {
      // Arrange
      const mockRouteHandler = {
        matchRoute: mock(() => ({
          kind: 'matched',
          params: {},
          route: {
            handler: mock(() => ({ created: true })),
            rawBody: false,
            sse: false,
            bodyLimit: undefined,
            status: 201,
            redirect: undefined,
            contentType: undefined,
            headers: [],
            applyResponseDefaults: (res: { setStatus: (s: number) => void }) => { res.setStatus(201); },
            pre: [],
            post: [],
            filters: [],
            validations: [],
          },
        })),
      };
      adapter.setRouteHandler(mockRouteHandler as never);

      const context = createHttpContext('POST', '/test');

      // Act
      await adapter.dispatchRequest(context);

      // Assert
      const http = context.to(HttpContext);
      expect(http.response.getStatus()).toBe(201);
    });

    it('should allow handler to override @Status decorator default', async () => {
      // Arrange
      const mockRouteHandler = {
        matchRoute: mock(() => ({
          kind: 'matched',
          params: {},
          route: {
            handler: mock((ctx: unknown) => {
              const http = (ctx as Context).to(HttpContext);
              http.response.setStatus(202);
              return { accepted: true };
            }),
            rawBody: false,
            sse: false,
            bodyLimit: undefined,
            status: 201,
            redirect: undefined,
            contentType: undefined,
            headers: [],
            pre: [],
            post: [],
            filters: [],
            validations: [],
          },
        })),
      };
      adapter.setRouteHandler(mockRouteHandler as never);

      const context = createHttpContext('POST', '/test');

      // Act
      await adapter.dispatchRequest(context);

      // Assert
      const http = context.to(HttpContext);
      expect(http.response.getStatus()).toBe(202);
    });

    it('should set default content-type via @ContentType decorator metadata', async () => {
      // Arrange
      const mockRouteHandler = {
        matchRoute: mock(() => ({
          kind: 'matched',
          params: {},
          route: {
            handler: mock(() => '<html>hello</html>'),
            rawBody: false,
            sse: false,
            bodyLimit: undefined,
            status: undefined,
            redirect: undefined,
            contentType: 'text/html',
            headers: [],
            applyResponseDefaults: (res: { setContentType: (ct: string) => void }) => { res.setContentType('text/html'); },
            pre: [],
            post: [],
            filters: [],
            validations: [],
          },
        })),
      };
      adapter.setRouteHandler(mockRouteHandler as never);

      const context = createHttpContext('GET', '/test');

      // Act
      await adapter.dispatchRequest(context);

      // Assert
      const http = context.to(HttpContext);
      expect(http.response.getContentType()).toContain('text/html');
    });

    it('should set static header via @Header decorator metadata', async () => {
      // Arrange
      const mockRouteHandler = {
        matchRoute: mock(() => ({
          kind: 'matched',
          params: {},
          route: {
            handler: mock(() => ({ data: 'ok' })),
            rawBody: false,
            sse: false,
            bodyLimit: undefined,
            status: undefined,
            redirect: undefined,
            contentType: undefined,
            headers: [['x-custom', 'value']],
            applyResponseDefaults: (res: { setHeader: (n: string, v: string) => void }) => { res.setHeader('x-custom', 'value'); },
            pre: [],
            post: [],
            filters: [],
            validations: [],
          },
        })),
      };
      adapter.setRouteHandler(mockRouteHandler as never);

      const context = createHttpContext('GET', '/test');

      // Act
      await adapter.dispatchRequest(context);

      // Assert
      const http = context.to(HttpContext);
      expect(http.response.getHeader('x-custom')).toBe('value');
    });

    it('should set Location header and default 302 via @Redirect decorator metadata', async () => {
      // Arrange
      const mockRouteHandler = {
        matchRoute: mock(() => ({
          kind: 'matched',
          params: {},
          route: {
            handler: mock(() => undefined),
            rawBody: false,
            sse: false,
            bodyLimit: undefined,
            status: undefined,
            redirect: { url: '/new-location', status: 302 },
            contentType: undefined,
            headers: [],
            applyResponseDefaults: (res: { redirect: (url: string, status?: number) => void }) => { res.redirect('/new-location', 302); },
            pre: [],
            post: [],
            filters: [],
            validations: [],
          },
        })),
      };
      adapter.setRouteHandler(mockRouteHandler as never);

      const context = createHttpContext('GET', '/old');

      // Act
      await adapter.dispatchRequest(context);

      // Assert
      const http = context.to(HttpContext);
      expect(http.response.getHeader('location')).toBe('/new-location');
      expect(http.response.getStatus()).toBe(302);
    });

    it('should apply multiple @Header decorators', async () => {
      // Arrange
      const mockRouteHandler = {
        matchRoute: mock(() => ({
          kind: 'matched',
          params: {},
          route: {
            handler: mock(() => ({ data: 'ok' })),
            rawBody: false,
            sse: false,
            bodyLimit: undefined,
            status: undefined,
            redirect: undefined,
            contentType: undefined,
            headers: [['x-first', 'one'], ['x-second', 'two'], ['x-third', 'three']],
            applyResponseDefaults: (res: { setHeader: (n: string, v: string) => void }) => {
              res.setHeader('x-first', 'one');
              res.setHeader('x-second', 'two');
              res.setHeader('x-third', 'three');
            },
            pre: [],
            post: [],
            filters: [],
            validations: [],
          },
        })),
      };
      adapter.setRouteHandler(mockRouteHandler as never);

      const context = createHttpContext('GET', '/test');

      // Act
      await adapter.dispatchRequest(context);

      // Assert
      const http = context.to(HttpContext);
      expect(http.response.getHeader('x-first')).toBe('one');
      expect(http.response.getHeader('x-second')).toBe('two');
      expect(http.response.getHeader('x-third')).toBe('three');
    });

    it('should allow handler imperative call to override decorator default', async () => {
      // Arrange
      const mockRouteHandler = {
        matchRoute: mock(() => ({
          kind: 'matched',
          params: {},
          route: {
            handler: mock((ctx: unknown) => {
              const http = (ctx as Context).to(HttpContext);
              http.response.setHeader('x-custom', 'overridden');
              return { data: 'ok' };
            }),
            rawBody: false,
            sse: false,
            bodyLimit: undefined,
            status: undefined,
            redirect: undefined,
            contentType: undefined,
            headers: [['x-custom', 'decorator-value']],
            pre: [],
            post: [],
            filters: [],
            validations: [],
          },
        })),
      };
      adapter.setRouteHandler(mockRouteHandler as never);

      const context = createHttpContext('GET', '/test');

      // Act
      await adapter.dispatchRequest(context);

      // Assert
      const http = context.to(HttpContext);
      expect(http.response.getHeader('x-custom')).toBe('overridden');
    });
  });

  // ── SSE vs Raw AsyncIterable Split ────────────────────────────

  describe('SSE vs raw AsyncIterable split', () => {
    it('should set text/event-stream headers and SSE framing when sse=true', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const context = createHttpContext('GET', '/sse');
      setSseRoute(context);
      const http = context.to(HttpContext);

      async function* sseGenerator() {
        yield { event: 'tick' };
      }

      // Act
      await writeResult(adapter, sseGenerator(), context);

      // Assert
      const nativeResponse = http.response.getNativeResponse();
      expect(nativeResponse).toBeInstanceOf(Response);
      expect(nativeResponse!.headers.get('content-type')).toBe('text/event-stream');
      expect(nativeResponse!.headers.get('cache-control')).toBe('no-cache');
      expect(nativeResponse!.headers.get('connection')).toBe('keep-alive');

      // Verify SSE framing
      const reader = nativeResponse!.body!.getReader();
      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);
      expect(text).toContain('data:');
      await reader.cancel();
    });

    it('should use raw streaming without SSE headers when sse=false', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const context = createHttpContext('GET', '/stream');
      const http = context.to(HttpContext);
      http.matchedRoute = {
        rawBody: false,
        sse: false,
        bodyLimit: undefined,
        status: undefined,
        redirect: undefined,
        contentType: undefined,
        headers: [],
        pre: [],
        post: [],
        filters: [],
        handler: () => undefined,
        validations: [],
      };

      const chunks = [new Uint8Array([0x01, 0x02]), new Uint8Array([0x03, 0x04])];
      let index = 0;
      const asyncIterable: AsyncIterable<unknown> = {
        [Symbol.asyncIterator]() {
          return {
            next() {
              if (index < chunks.length) {
                const value = chunks[index]!;
                index++;
                return Promise.resolve({ done: false as const, value });
              }
              return Promise.resolve({ done: true as const, value: undefined });
            },
          };
        },
      };

      // Act
      await writeResult(adapter, asyncIterable, context);

      // Assert — no SSE headers
      const nativeResponse = http.response.getNativeResponse();
      expect(nativeResponse).toBeInstanceOf(Response);
      expect(nativeResponse!.headers.get('content-type')).not.toBe('text/event-stream');

      // Verify raw chunks passed through as-is
      const reader = nativeResponse!.body!.getReader();
      const firstRead = await reader.read();
      expect(firstRead.done).toBe(false);
      expect(firstRead.value).toEqual(new Uint8Array([0x01, 0x02]));
      await reader.cancel();
    });

    it('should encode string chunks as UTF-8 when sse=false', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const context = createHttpContext('GET', '/stream');
      const http = context.to(HttpContext);
      http.matchedRoute = {
        rawBody: false,
        sse: false,
        bodyLimit: undefined,
        status: undefined,
        redirect: undefined,
        contentType: undefined,
        headers: [],
        pre: [],
        post: [],
        filters: [],
        handler: () => undefined,
        validations: [],
      };

      async function* stringGenerator() {
        yield 'hello';
        yield 'world';
      }

      // Act
      await writeResult(adapter, stringGenerator(), context);

      // Assert
      const nativeResponse = http.response.getNativeResponse();
      const reader = nativeResponse!.body!.getReader();
      const firstRead = await reader.read();
      expect(firstRead.done).toBe(false);
      const decoded = new TextDecoder().decode(firstRead.value);
      expect(decoded).toBe('hello');
      await reader.cancel();
    });
  });

  // ── Route-Level bodyLimit ─────────────────────────────────────

  describe('route-level bodyLimit', () => {
    const { parseBody } = require('./body');
    const EMPTY_TEXT_MEDIA_TYPES = new Set<string>();
    const GLOBAL_BODY_LIMIT = 1024;

    it('should use route bodyLimit when it overrides global bodyLimit', async () => {
      // Arrange
      const smallBody = JSON.stringify({ data: 'x'.repeat(100) });
      const rawRequest = new Request('http://localhost/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': smallBody.length.toString() },
        body: smallBody,
      });

      const req = createStubHttpRequest({
        method: 'POST',
        originalMethod: 'POST',
        headers: new Headers({ 'content-type': 'application/json', 'content-length': smallBody.length.toString() }),
        contentLength: smallBody.length,
      }) as InstanceType<typeof HttpRequest>;
      const res = new HttpResponse(req, new Headers());
      const http = new HttpContext(req, res, rawRequest);

      // Route bodyLimit is 50 bytes — smaller than body
      http.matchedRoute = {
        rawBody: false,
        sse: false,
        bodyLimit: 50,
        status: undefined,
        redirect: undefined,
        contentType: undefined,
        headers: [],
        pre: [],
        post: [],
        filters: [],
        handler: mock(() => ({})),
        validations: [],
      };

      // Act
      const result = await parseBody(http, GLOBAL_BODY_LIMIT, EMPTY_TEXT_MEDIA_TYPES);

      // Assert — should reject because route bodyLimit (50) < body size
      expect(isErr(result)).toBe(true);
      expect(result.data.status).toBe(413);
    });

    it('should use global bodyLimit when route bodyLimit is undefined', async () => {
      // Arrange — global bodyLimit is 1024, body is 500 bytes
      const bodyContent = JSON.stringify({ data: 'x'.repeat(450) });
      const rawRequest = new Request('http://localhost/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': bodyContent.length.toString() },
        body: bodyContent,
      });

      const req = createStubHttpRequest({
        method: 'POST',
        originalMethod: 'POST',
        headers: new Headers({ 'content-type': 'application/json', 'content-length': bodyContent.length.toString() }),
        contentLength: bodyContent.length,
      }) as InstanceType<typeof HttpRequest>;
      const res = new HttpResponse(req, new Headers());
      const http = new HttpContext(req, res, rawRequest);

      http.matchedRoute = {
        rawBody: false,
        sse: false,
        bodyLimit: undefined,
        status: undefined,
        redirect: undefined,
        contentType: undefined,
        headers: [],
        pre: [],
        post: [],
        filters: [],
        handler: mock(() => ({})),
        validations: [],
      };

      // Act
      const result = await parseBody(http, GLOBAL_BODY_LIMIT, EMPTY_TEXT_MEDIA_TYPES);

      // Assert — body within global limit, should parse successfully
      expect(isErr(result)).not.toBe(true);
      expect(req.body).toBeDefined();
    });

    it('should return 413 when content-length exceeds route bodyLimit', async () => {
      // Arrange
      const largeBody = JSON.stringify({ data: 'x'.repeat(200) });
      const rawRequest = new Request('http://localhost/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': largeBody.length.toString() },
        body: largeBody,
      });

      const req = createStubHttpRequest({
        method: 'POST',
        originalMethod: 'POST',
        headers: new Headers({ 'content-type': 'application/json', 'content-length': largeBody.length.toString() }),
        contentLength: largeBody.length,
      }) as InstanceType<typeof HttpRequest>;
      const res = new HttpResponse(req, new Headers());
      const http = new HttpContext(req, res, rawRequest);

      // Route bodyLimit = 100 bytes, body > 100
      http.matchedRoute = {
        rawBody: false,
        sse: false,
        bodyLimit: 100,
        status: undefined,
        redirect: undefined,
        contentType: undefined,
        headers: [],
        pre: [],
        post: [],
        filters: [],
        handler: mock(() => ({})),
        validations: [],
      };

      // Act
      const result = await parseBody(http, GLOBAL_BODY_LIMIT, EMPTY_TEXT_MEDIA_TYPES);

      // Assert
      expect(isErr(result)).toBe(true);
      expect(result.data.status).toBe(413);
    });
  });

  describe('resolveRoute — 404 message security', () => {
    it('should return generic Not Found message without leaking path', () => {
      // Arrange
      const adapter = new HttpAdapter();
      const mockRouteHandler = {
        matchRoute: () => ({ kind: 'not-found' }),
      };
      (adapter as any).routeHandler = mockRouteHandler;
      const context = createHttpContext('GET', '/secret-admin-panel');
      const http = context.to(HttpContext);

      // Act
      const result = (adapter as unknown as { resolveRoute: (h: HttpContext) => Result<void, ErrorResponseData> }).resolveRoute(http);

      // Assert
      if (!isErr(result)) throw new Error("expected Err");
      expect(result.data.status).toBe(404);
      expect(result.data.message).toBe('Not Found');
      expect(result.data.message).not.toContain('/secret-admin-panel');
    });
  });

  describe('readBodyWithLimit — stream cancellation behavior', () => {
    const parseBodyFn = parseBody;
    const EMPTY_TEXT_MEDIA_TYPES_2 = new Set<string>();

    it('should return 413 when chunked body exceeds route-level bodyLimit', async () => {
      // Arrange — text/plain + rawBody + no CL → chunked readBodyWithLimit path
      const largeBody = 'A'.repeat(200); // 200 bytes > 100 limit
      const rawRequest = new Request('http://localhost/test', {
        method: 'POST',
        body: largeBody,
        headers: { 'content-type': 'text/plain' },
      });
      const req = createStubHttpRequest({
        method: 'POST',
        originalMethod: 'POST',
        headers: new Headers({ 'content-type': 'text/plain' }),
        contentLength: null, // forces chunked path
      }) as InstanceType<typeof HttpRequest>;
      const res = new HttpResponse(req, new Headers());
      const http = new HttpContext(req, res, rawRequest);

      http.matchedRoute = {
        rawBody: true,
        sse: false,
        bodyLimit: 100,
        status: undefined,
        redirect: undefined,
        contentType: undefined,
        headers: [],
        pre: [],
        post: [],
        filters: [],
        handler: mock(() => ({})),
        validations: [],
      };

      // Act
      const result = await parseBodyFn(http, 10 * 1024 * 1024, EMPTY_TEXT_MEDIA_TYPES_2);

      // Assert
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.status).toBe(413);
      }
    });
  });

  describe('RFC 9110 error message compliance (httpError factory)', () => {
    it('should use Content Too Large as default message for 413', () => {
      const { httpError } = require('./http-error');
      const e = httpError(413);
      expect(e.data.message).toBe('Content Too Large');
      expect(e.data.status).toBe(413);
    });

    it('should use URI Too Long as default message for 414', () => {
      const { httpError } = require('./http-error');
      const e = httpError(414);
      expect(e.data.message).toBe('URI Too Long');
      expect(e.data.status).toBe(414);
    });

    it('should use Unprocessable Content as default message for 422', () => {
      const { httpError } = require('./http-error');
      const e = httpError(422);
      expect(e.data.message).toBe('Unprocessable Content');
      expect(e.data.status).toBe(422);
    });
  });

  // ── registerInternalRoute ──────────────────────────────────

  describe('registerInternalRoute', () => {
    it('should push route entry to internalRoutes array', () => {
      // Arrange
      const adapter = new HttpAdapter();
      const handler = mock(() => new Response('docs'));

      // Act
      adapter.registerInternalRoute('GET', '/docs', handler);

      // Assert
      const routes = (adapter as any).internalRoutes;
      expect(routes).toHaveLength(1);
      expect(routes[0].method).toBe('GET');
      expect(routes[0].path).toBe('/docs');
      expect(routes[0].handler).toBe(handler);
    });

    it('should accumulate multiple internal routes', () => {
      // Arrange
      const adapter = new HttpAdapter();

      // Act
      adapter.registerInternalRoute('GET', '/docs', mock(() => new Response('docs')));
      adapter.registerInternalRoute('GET', '/health', mock(() => new Response('ok')));

      // Assert
      const routes = (adapter as any).internalRoutes;
      expect(routes).toHaveLength(2);
      expect(routes[0].path).toBe('/docs');
      expect(routes[1].path).toBe('/health');
    });
  });

  // ── Lifecycle: stop / drain ────────────────────────────────

  describe('stop', () => {
    it('should call httpServer.stop() when server exists', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const mockStop = mock(() => Promise.resolve());
      (adapter as any).httpServer = { stop: mockStop };

      // Act
      await adapter.stop();

      // Assert
      expect(mockStop).toHaveBeenCalledTimes(1);
    });

    it('should be no-op when httpServer is undefined', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      (adapter as any).httpServer = undefined;

      // Act & Assert — should not throw
      await adapter.stop();
    });
  });

  describe('drain', () => {
    it('should be no-op when httpServer is undefined', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      (adapter as any).httpServer = undefined;

      // Act & Assert — should not throw
      await adapter.drain(1000);
    });

    it('should be no-op when underlying server is null', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      (adapter as any).httpServer = { getServer: () => undefined };

      // Act & Assert — should not throw
      await adapter.drain(1000);
    });

    it('should call server.stop() for graceful drain', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const mockServerStop = mock(() => Promise.resolve());
      const mockServer = {
        stop: mockServerStop,
        pendingRequests: 0,
        pendingWebSockets: 0,
      };
      (adapter as any).httpServer = { getServer: () => mockServer };

      // Act
      await adapter.drain(1000);

      // Assert
      expect(mockServerStop).toHaveBeenCalledTimes(1);
    });

    it('should force close when pending requests remain after timeout', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const stopCalls: (boolean | undefined)[] = [];
      const mockServer = {
        stop: mock((force?: boolean) => {
          stopCalls.push(force);
          // Simulate slow drain — never resolves
          if (force === undefined) return new Promise(() => {});
          return Promise.resolve();
        }),
        pendingRequests: 5,
        pendingWebSockets: 0,
      };
      (adapter as any).httpServer = { getServer: () => mockServer };

      // Act — timeout = 10ms
      await adapter.drain(10);

      // Assert — first call is graceful (no arg), second is force (true)
      expect(stopCalls.length).toBeGreaterThanOrEqual(2);
      expect(stopCalls[0]).toBeUndefined(); // graceful
      expect(stopCalls[1]).toBe(true); // force
    });

    it('should force close when pending WebSockets remain after timeout', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const stopCalls: (boolean | undefined)[] = [];
      const mockServer = {
        stop: mock((force?: boolean) => {
          stopCalls.push(force);
          if (force === undefined) return new Promise(() => {});
          return Promise.resolve();
        }),
        pendingRequests: 0,
        pendingWebSockets: 3,
      };
      (adapter as any).httpServer = { getServer: () => mockServer };

      // Act
      await adapter.drain(10);

      // Assert
      expect(stopCalls.length).toBeGreaterThanOrEqual(2);
      expect(stopCalls[1]).toBe(true);
    });

    it('should not force close when drain completes before timeout', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const stopCalls: (boolean | undefined)[] = [];
      const mockServer = {
        stop: mock((force?: boolean) => {
          stopCalls.push(force);
          return Promise.resolve(); // resolves immediately
        }),
        pendingRequests: 0,
        pendingWebSockets: 0,
      };
      (adapter as any).httpServer = { getServer: () => mockServer };

      // Act
      await adapter.drain(5000);

      // Assert — only graceful stop called
      expect(stopCalls).toEqual([undefined]);
    });
  });

  // ── getMetrics (operational observability) ────────────────

  describe('getMetrics', () => {
    it('should return undefined when httpServer is not started', () => {
      const adapter = new HttpAdapter();

      expect(adapter.getMetrics()).toBeUndefined();
    });

    it('should delegate to httpServer.getMetrics and return the snapshot', () => {
      const adapter = new HttpAdapter();
      const snapshot = { pendingRequests: 3, pendingWebSockets: 1 };
      (adapter as any).httpServer = { getMetrics: () => snapshot };

      expect(adapter.getMetrics()).toEqual(snapshot);
    });

    it('should return undefined when httpServer.getMetrics returns undefined', () => {
      const adapter = new HttpAdapter();
      (adapter as any).httpServer = { getMetrics: () => undefined };

      expect(adapter.getMetrics()).toBeUndefined();
    });
  });

  // ── Metadata normalization ─────────────────────────────────

  describe('normalizeMetadataRegistry', () => {
    const { normalizeMetadataRegistry } = require('./metadata');

    it('should return undefined when registry is undefined', () => {
      const result = normalizeMetadataRegistry(undefined);
      expect(result).toBeUndefined();
    });

    it('should normalize core class metadata to http class metadata', () => {
      class TestClass {}
      const registry = new Map();
      registry.set(TestClass, {
        decorators: [{ name: 'RestController' }],
        constructorParams: [{ type: 'SomeService' }],
      });

      const result = assertDefined(normalizeMetadataRegistry(registry), 'normalized registry');
      expect(result.size).toBe(1);
      const meta = assertDefined(result.get(TestClass), 'TestClass metadata');
      expect(meta.decorators).toEqual([{ name: 'RestController' }]);
      expect(meta.constructorParams).toEqual([{ type: 'SomeService' }]);
    });

    it('should pass through already-http metadata unchanged', () => {
      class TestClass {}
      const httpMeta = {
        className: 'TestClass',
        methods: {},
        decorators: [{ name: 'RestController' }],
      };
      const registry = new Map();
      registry.set(TestClass, httpMeta);

      const result = assertDefined(normalizeMetadataRegistry(registry), 'normalized registry');
      expect(result.get(TestClass) as unknown).toBe(httpMeta);
    });

    it('should skip non-class-token keys (strings, symbols)', () => {
      const registry = new Map();
      registry.set('StringKey', { decorators: [] });
      registry.set(Symbol('sym'), { decorators: [] });
      class ValidClass {}
      registry.set(ValidClass, { decorators: [{ name: 'Controller' }] });

      const result = normalizeMetadataRegistry(registry);

      expect(result.size).toBe(1);
      expect(result.has(ValidClass)).toBe(true);
    });

    it('should handle metadata without decorators or constructorParams', () => {
      class TestClass {}
      const registry = new Map();
      registry.set(TestClass, {});

      const result = normalizeMetadataRegistry(registry);

      const meta = result.get(TestClass);
      expect(meta).toBeDefined();
      expect(meta.decorators).toBeUndefined();
      expect(meta.constructorParams).toBeUndefined();
    });

    it('should normalize constructorParams with decorator metadata', () => {
      class TestClass {}
      const registry = new Map();
      registry.set(TestClass, {
        constructorParams: [
          { type: 'ServiceA', decorators: [{ name: 'Inject' }] },
          { type: Symbol.for('token') },
          { type: 12345 },  // non-provider token (number)
        ],
      });

      const result = assertDefined(normalizeMetadataRegistry(registry), 'normalized registry');
      const meta = assertDefined(result.get(TestClass), "TestClass metadata");
      const params = assertDefined(meta.constructorParams, "constructorParams");
      expect(params).toHaveLength(3);
      expect(assertDefined(params[0], 'param[0]').type).toBe('ServiceA');
      expect(assertDefined(params[0], 'param[0]').decorators).toEqual([{ name: 'Inject' }]);
      expect(assertDefined(params[1], 'param[1]').type).toBe(Symbol.for('token'));
      expect(assertDefined(params[2], 'param[2]').type).toBeUndefined(); // number is not a provider token
    });
  });

  // ── isProviderToken ────────────────────────────────────────

  describe('isProviderToken', () => {
    const { isProviderToken } = require('./metadata');

    it('should return true for string token', () => {
      expect(isProviderToken('ServiceA')).toBe(true);
    });

    it('should return true for symbol token', () => {
      expect(isProviderToken(Symbol('test'))).toBe(true);
    });

    it('should return true for function/class token', () => {
      class MyService {}
      expect(isProviderToken(MyService)).toBe(true);
    });

    it('should return false for number', () => {
      expect(isProviderToken(42 as unknown as never)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(isProviderToken(undefined)).toBe(false);
    });

    it('should return false for null', () => {
      expect(isProviderToken(null as unknown as never)).toBe(false);
    });
  });

  // ── isHttpClassMetadata ────────────────────────────────────

  describe('isHttpClassMetadata', () => {
    const { isHttpClassMetadata } = require('./metadata');

    it('should return true when value has methods property', () => {
      expect(isHttpClassMetadata({ methods: [] } as never)).toBe(true);
    });

    it('should return true when value has className property', () => {
      expect(isHttpClassMetadata({ className: 'Test' })).toBe(true);
    });

    it('should return false for core metadata without methods/className', () => {
      expect(isHttpClassMetadata({ decorators: [] })).toBe(false);
    });
  });

  // ── wrapValidationError ───────────────────────────────────

  describe('wrapValidationError', () => {
    const fakeEntry = { accessor: ['request', 'getBody'], metatype: class Dto {}, readInput: () => undefined, writeOutput: () => {} };

    it('should rethrow non-baker errors', () => {
      const adapter = new HttpAdapter();
      const customError = new Error('not a baker error');

      expect(() => (adapter as any).wrapValidationError(fakeEntry, customError)).toThrow(customError);
    });

    it('should rethrow plain objects that are not baker errors', () => {
      const adapter = new HttpAdapter();
      const plainObj = { message: 'nope' };

      expect(() => (adapter as any).wrapValidationError(fakeEntry, plainObj)).toThrow();
    });
  });

});
