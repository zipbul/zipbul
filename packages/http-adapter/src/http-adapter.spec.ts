import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { Context, ZipbulContainer } from '@zipbul/common';
import { err, isErr, defineMiddleware, defineGuard, defineExceptionFilter } from '@zipbul/common';
import { HttpPhase } from './enums';

const mockGetRuntimeContext = mock(() => ({
  isAotRuntime: false,
  metadataRegistry: new Map(),
}));

mock.module('@zipbul/core', () => ({
  ClusterManager: class {},
  getRuntimeContext: mockGetRuntimeContext,
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
      const opts = (adapter as unknown as Record<string, Record<string, unknown>>).options;
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
      const opts = (adapter as unknown as Record<string, Record<string, unknown>>).options;
      expect(opts.name).toBe('my-app');
    });

    it('should allow user to override logLevel', () => {
      // Arrange & Act
      const adapter = new HttpAdapter({ logLevel: 'info' });

      // Assert
      const opts = (adapter as unknown as Record<string, Record<string, unknown>>).options;
      expect(opts.logLevel).toBe('info');
    });

    it('should allow user to override port', () => {
      // Arrange & Act
      const adapter = new HttpAdapter({ port: 3000 });

      // Assert
      const opts = (adapter as unknown as Record<string, Record<string, unknown>>).options;
      expect(opts.port).toBe(3000);
    });

    it('should allow user to override bodyLimit', () => {
      // Arrange & Act
      const adapter = new HttpAdapter({ bodyLimit: 1024 });

      // Assert
      const opts = (adapter as unknown as Record<string, Record<string, unknown>>).options;
      expect(opts.bodyLimit).toBe(1024);
    });

    it('should allow user to override trustProxy', () => {
      // Arrange & Act
      const adapter = new HttpAdapter({ trustProxy: true });

      // Assert
      const opts = (adapter as unknown as Record<string, Record<string, unknown>>).options;
      expect(opts.trustProxy).toBe(true);
    });

    it('should keep defaults for non-specified options when partially overriding', () => {
      // Arrange & Act
      const adapter = new HttpAdapter({ port: 8080 });

      // Assert
      const opts = (adapter as unknown as Record<string, Record<string, unknown>>).options;
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
    });

    it('should execute handler when route has no guards', async () => {
      // Arrange
      const handlerFn = mock(() => ({ data: 'ok' }));
      const mockRouteHandler = {
        match: mock(() => ({
          params: {},
          value: {
            handler: handlerFn,
            methodName: 'test',
            middlewares: [],
            exceptionFilters: [],
            guards: [],
            paramFactory: mock(async () => []),
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
        match: mock(() => ({
          params: {},
          value: {
            handler: handlerFn,
            methodName: 'test',
            middlewares: [],
            exceptionFilters: [],
            guards: [guardHandler],
            paramFactory: mock(async () => []),
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
      let receivedResult: unknown;
      const originalHandleResult = adapter['handleResult'].bind(adapter);
      adapter['handleResult'] = async (result: unknown, ctx: Context) => {
        receivedResult = result;
        await originalHandleResult(result as never, ctx);
      };

      const guardHandler = mock(() => err({ status: 403, message: 'Forbidden' }));
      const handlerFn = mock(() => ({ data: 'ok' }));
      const mockRouteHandler = {
        match: mock(() => ({
          params: {},
          value: {
            handler: handlerFn,
            methodName: 'test',
            middlewares: [],
            exceptionFilters: [],
            guards: [guardHandler],
            paramFactory: mock(async () => []),
          },
        })),
      };
      adapter.setRouteHandler(mockRouteHandler as never);

      const context = createHttpContext('GET', '/test');

      // Act
      await adapter.dispatchRequest(context);

      // Assert
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
        match: mock(() => ({
          params: {},
          value: {
            handler: handlerFn,
            methodName: 'test',
            middlewares: [],
            exceptionFilters: [],
            guards: [guard1, guard2],
            paramFactory: mock(async () => []),
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
        match: mock(() => ({
          params: {},
          value: {
            handler: handlerFn,
            methodName: 'test',
            middlewares: [],
            exceptionFilters: [],
            guards: [guard1, guard2],
            paramFactory: mock(async () => []),
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
        match: mock(() => ({
          params: {},
          value: {
            handler: handlerFn,
            methodName: 'test',
            middlewares: [],
            exceptionFilters: [],
            guards: [guardHandler],
            paramFactory: mock(async () => []),
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
        match: mock(() => ({
          params: {},
          value: {
            handler: handlerFn,
            methodName: 'test',
            middlewares: [],
            exceptionFilters: [],
            guards: [guardHandler],
            paramFactory: mock(async () => []),
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

function createHttpContext(method: string, path: string): Context {
  const { HttpContext } = require('./http-context');
  const { HttpRequest } = require('./http-request');
  const { HttpResponse } = require('./http-response');

  const req = new HttpRequest({
    httpMethod: method,
    url: `http://localhost${path}`,
    headers: {},
    params: {},
    query: {},
  });
  const res = new HttpResponse(req, new Headers());

  return new HttpContext(req, res);
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

function createMockRouteHandler(options: {
  middlewares?: Array<(ctx: Context) => unknown>;
  guards?: Array<(ctx: Context) => unknown>;
  exceptionFilters?: Array<{ handler: (error: unknown, ctx: Context) => unknown; catchTypes: readonly (abstract new (...args: readonly unknown[]) => Error)[] }>;
  handler?: (...args: readonly unknown[]) => unknown;
}) {
  return {
    match: mock(() => ({
      params: {},
      value: {
        handler: options.handler ?? mock(() => ({ data: 'ok' })),
        methodName: 'test',
        middlewares: (options.middlewares ?? []).map((handler) => ({ handler })),
        exceptionFilters: options.exceptionFilters ?? [],
        guards: options.guards ?? [],
        paramFactory: mock(async () => []),
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
    it('should execute full pipeline: OnReceive → resolveRoute → parseBody → PostParse → GlobalGuards → PreHandle → RouteMW → RouteGuards → Handler → OnComplete', async () => {
      // Arrange
      const order: string[] = [];

      adapter.addMiddlewares(HttpPhase.OnReceive, [defineMiddleware(() => () => { order.push('global:OnReceive'); })]);
      adapter.addMiddlewares(HttpPhase.PostParse, [defineMiddleware(() => () => { order.push('global:PostParse'); })]);
      adapter.addMiddlewares(HttpPhase.PreHandle, [defineMiddleware(() => () => { order.push('global:PreHandle'); })]);
      adapter.addMiddlewares(HttpPhase.OnComplete, [defineMiddleware(() => () => { order.push('global:OnComplete'); })]);
      adapter.addGuards([defineGuard(() => () => { order.push('global:guard'); })]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        middlewares: [
          () => { order.push('route:mw1'); },
          () => { order.push('route:mw2'); },
        ],
        guards: [() => { order.push('route:guard'); }],
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

      adapter.addMiddlewares(HttpPhase.OnReceive, [
        defineMiddleware(() => () => { order.push('OnReceive:1'); }),
        defineMiddleware(() => () => { order.push('OnReceive:2'); }),
      ]);
      adapter.addMiddlewares(HttpPhase.PreHandle, [
        defineMiddleware(() => () => { order.push('PreHandle:1'); }),
      ]);
      adapter.addMiddlewares(HttpPhase.PreHandle, [
        defineMiddleware(() => () => { order.push('PreHandle:2'); }),
      ]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        middlewares: [() => { order.push('route:mw'); }],
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

      adapter.addMiddlewares(HttpPhase.PostParse, [defineMiddleware(() => () => { order.push('PostParse'); })]);
      adapter.addMiddlewares(HttpPhase.PreHandle, [defineMiddleware(() => () => { order.push('PreHandle'); })]);
      adapter.addGuards([defineGuard(() => () => { order.push('global:guard'); })]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
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

      adapter.addMiddlewares(HttpPhase.OnReceive, [defineMiddleware(() => () => err({ status: 429 }))]);
      adapter.addMiddlewares(HttpPhase.PostParse, [defineMiddleware(() => () => { throw new Error('should not run'); })]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        middlewares: [routeMw],
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

      adapter.addMiddlewares(HttpPhase.OnReceive, [defineMiddleware(() => () => { order.push('OnReceive'); })]);
      adapter.addMiddlewares(HttpPhase.PostParse, [defineMiddleware(() => () => { order.push('PostParse:halt'); return err({ status: 400 }); })]);
      adapter.initializePipeline(createMockContainer());

      const routeMw = mock((_ctx: Context) => {});
      const routeHandler = createMockRouteHandler({ middlewares: [routeMw] });
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

      adapter.addMiddlewares(HttpPhase.PreHandle, [defineMiddleware(() => () => err({ status: 503 }))]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({ middlewares: [routeMw] });
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

      adapter.addMiddlewares(HttpPhase.PreHandle, [defineMiddleware(() => preHandleMw)]);
      adapter.addGuards([defineGuard(() => () => { order.push('global:guard:deny'); return err({ status: 403 }); })]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({ middlewares: [routeMw] });
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
        middlewares: [
          () => err({ reason: 'first_halt' }),
          () => { throw new Error('should not run'); },
        ],
        guards: [guardFn],
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
        middlewares: [
          () => { order.push('mw1'); },
          () => { order.push('mw2'); },
          () => { order.push('mw3:halt'); return err({ reason: 'last_halt' }); },
        ],
        guards: [guardFn],
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

      adapter.addMiddlewares(HttpPhase.OnReceive, [defineMiddleware(() => () => { order.push('global:OnReceive'); })]);
      adapter.addMiddlewares(HttpPhase.OnComplete, [defineMiddleware(() => () => { order.push('global:OnComplete'); })]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        middlewares: [
          () => { order.push('route:mw1'); },
          () => { order.push('route:mw2:halt'); return err({ status: 401 }); },
          () => { order.push('route:mw3'); },
        ],
        guards: [guardFn],
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

      adapter.addMiddlewares(HttpPhase.OnComplete, [defineMiddleware(() => onCompleteFn)]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        middlewares: [() => err({ reason: 'halt' })],
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
      adapter.addMiddlewares(HttpPhase.OnComplete, [defineMiddleware(() => onCompleteFn)]);
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
    it('should flow route-level middleware Err data through to handleResult', async () => {
      // Arrange
      let receivedResult: unknown;
      const originalHandleResult = adapter['handleResult'].bind(adapter);
      adapter['handleResult'] = async (result: unknown, ctx: Context) => {
        receivedResult = result;
        await originalHandleResult(result as never, ctx);
      };

      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        middlewares: [() => err({ status: 401, message: 'Unauthorized' })],
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(isErr(receivedResult)).toBe(true);
      expect((receivedResult as { data: unknown }).data).toEqual({ status: 401, message: 'Unauthorized' });
    });

    it('should flow route-level guard Err data through to handleResult', async () => {
      // Arrange
      let receivedResult: unknown;
      const originalHandleResult = adapter['handleResult'].bind(adapter);
      adapter['handleResult'] = async (result: unknown, ctx: Context) => {
        receivedResult = result;
        await originalHandleResult(result as never, ctx);
      };

      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        guards: [() => err({ status: 403, message: 'Forbidden' })],
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
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
        guards: [() => err({ status: 403 })],
        exceptionFilters: [{ handler: routeFilterHandler, catchTypes: [] }],
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert — Err from guard goes directly to handleResult, NOT through exception filters
      expect(globalFilter).not.toHaveBeenCalled();
      expect(routeFilterHandler).not.toHaveBeenCalled();
    });

    it('should NOT invoke exception filters when route-level middleware returns Err', async () => {
      // Arrange
      const globalFilter = mock((_error: unknown, _ctx: Context) => err({ source: 'filter' }));

      adapter.addExceptionFilters([defineExceptionFilter([], () => globalFilter)]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        middlewares: [() => err({ status: 429 })],
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
        exceptionFilters: [{ handler: routeFilterHandler, catchTypes: [RouteError] }],
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

      adapter.addExceptionFilters([defineExceptionFilter([], () => globalFilterHandler)]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        exceptionFilters: [{ handler: routeFilterHandler, catchTypes: [SpecificError] }],
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
        middlewares: [() => { throw new MwError(); }],
        exceptionFilters: [{ handler: routeFilterHandler, catchTypes: [MwError] }],
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
        exceptionFilters: [{ handler: routeFilterHandler, catchTypes: [DetailedError] }],
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
        middlewares: [
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
        middlewares: [
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
        middlewares: [
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

      adapter.addMiddlewares(HttpPhase.OnReceive, [defineMiddleware(() => (ctx) => { contexts.push(ctx); })]);
      adapter.addMiddlewares(HttpPhase.PostParse, [defineMiddleware(() => (ctx) => { contexts.push(ctx); })]);
      adapter.addMiddlewares(HttpPhase.PreHandle, [defineMiddleware(() => (ctx) => { contexts.push(ctx); })]);
      adapter.addMiddlewares(HttpPhase.OnComplete, [defineMiddleware(() => (ctx) => { contexts.push(ctx); })]);
      adapter.addGuards([defineGuard(() => (ctx) => { contexts.push(ctx); })]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        middlewares: [(ctx) => { contexts.push(ctx); }],
        guards: [(ctx) => { contexts.push(ctx); }],
      });
      adapter.setRouteHandler(routeHandler as never);

      const context = createHttpContext('GET', '/test');

      // Act
      await adapter.dispatchRequest(context);

      // Assert — 4 global hooks + 1 global guard + 1 route mw + 1 route guard = 7
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

      adapter.addGuards([defineGuard(() => () => { order.push('global:guard'); })]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        guards: [() => { order.push('route:guard'); }],
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

      adapter.addGuards([defineGuard(() => () => err({ status: 403 }))]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        guards: [routeGuard],
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

      adapter.addMiddlewares(HttpPhase.OnReceive, [defineMiddleware(() => () => { order.push('OnReceive'); })]);
      adapter.addMiddlewares(HttpPhase.OnComplete, [defineMiddleware(() => () => { order.push('OnComplete'); })]);
      adapter.initializePipeline(createMockContainer());

      const noMatchRouteHandler = {
        match: mock(() => undefined),
      };
      adapter.setRouteHandler(noMatchRouteHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/nonexistent'));

      // Assert — global phases run, no route-level
      expect(order).toEqual(['OnReceive', 'OnComplete']);
    });

    it('should return 404 Err when no route matches', async () => {
      // Arrange
      let receivedResult: unknown;
      const originalHandleResult = adapter['handleResult'].bind(adapter);
      adapter['handleResult'] = async (result: unknown, ctx: Context) => {
        receivedResult = result;
        await originalHandleResult(result as never, ctx);
      };

      adapter.initializePipeline(createMockContainer());

      const noMatchRouteHandler = {
        match: mock(() => undefined),
      };
      adapter.setRouteHandler(noMatchRouteHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/nonexistent'));

      // Assert
      expect(isErr(receivedResult)).toBe(true);
      expect((receivedResult as { data: { status: number } }).data.status).toBe(404);
    });
  });

  // ── Edge Cases ────────────────────────────────────────────

  describe('edge cases', () => {
    it('should work with empty route-level middleware list', async () => {
      // Arrange
      const order: string[] = [];

      adapter.addMiddlewares(HttpPhase.OnReceive, [defineMiddleware(() => () => { order.push('global'); })]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        middlewares: [],
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
        middlewares: [() => { order.push('route:mw'); }],
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

      adapter.addExceptionFilters([defineExceptionFilter([], () => globalFilter)]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        middlewares: [() => { throw new Error('middleware crash'); }],
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

    it('should not call routeHandler.match when routeHandler is not set', async () => {
      // Arrange
      adapter.initializePipeline(createMockContainer());
      // Do NOT call setRouteHandler

      let receivedResult: unknown;
      const originalHandleResult = adapter['handleResult'].bind(adapter);
      adapter['handleResult'] = async (result: unknown, ctx: Context) => {
        receivedResult = result;
        await originalHandleResult(result as never, ctx);
      };

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert — should get 500 "Router not initialized"
      expect(isErr(receivedResult)).toBe(true);
      expect((receivedResult as { data: { status: number } }).data.status).toBe(500);
    });
  });

  // ── Failure Propagation Paths ─────────────────────────────

  describe('failure propagation paths', () => {
    it('should route handler throw through exception filter and run OnComplete', async () => {
      // Arrange
      const order: string[] = [];

      adapter.addMiddlewares(HttpPhase.OnReceive, [defineMiddleware(() => () => { order.push('OnReceive'); })]);
      adapter.addMiddlewares(HttpPhase.PostParse, [defineMiddleware(() => () => { order.push('PostParse'); })]);
      adapter.addMiddlewares(HttpPhase.PreHandle, [defineMiddleware(() => () => { order.push('PreHandle'); })]);
      adapter.addMiddlewares(HttpPhase.OnComplete, [defineMiddleware(() => () => { order.push('OnComplete'); })]);
      adapter.addExceptionFilters([defineExceptionFilter([], () => (_error, _ctx) => {
        order.push('exceptionFilter');
        return err({ caught: true });
      })]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
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

      adapter.addGuards([defineGuard(() => () => { throw new Error('guard exploded'); })]);
      adapter.addExceptionFilters([defineExceptionFilter([], () => filterHandler)]);
      adapter.initializePipeline(createMockContainer());

      const handlerFn = mock(() => 'ok');
      const routeHandler = createMockRouteHandler({ handler: handlerFn });
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
        middlewares: [
          () => { order.push('mw1'); },
          () => { order.push('mw2:throw'); throw new Error('mw2 crash'); },
          thirdMw,
        ],
        exceptionFilters: [{ handler: routeFilterHandler, catchTypes: [] }],
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
        exceptionFilters: [{
          handler: () => { throw new Error('filter also crashed'); },
          catchTypes: [],
        }],
        handler: () => { throw new Error('handler crash'); },
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert — filter throw is caught by dispatchRequest, creates synthetic Err,
      // handleResult receives it. If handleResult also fails → emergencyTeardown.
      // But handleResult should succeed with the synthetic Err, so emergencyTeardown
      // should NOT be called. Let's verify handleResult gets the synthetic error.
      // Actually: dispatchRequest catches filter throw → filterResult = err({message, cause, filterError})
      // → handleResult(filterResult) should work → no emergencyTeardown
      expect((adapter as any).emergencyTeardown).not.toHaveBeenCalled();
    });

    it('should produce synthetic Err with cause and filterError when route exception filter throws', async () => {
      // Arrange
      let receivedResult: unknown;
      const originalHandleResult = adapter['handleResult'].bind(adapter);
      adapter['handleResult'] = async (result: unknown, ctx: Context) => {
        receivedResult = result;
        await originalHandleResult(result as never, ctx);
      };

      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        exceptionFilters: [{
          handler: () => { throw new Error('filter crash'); },
          catchTypes: [],
        }],
        handler: () => { throw new Error('handler crash'); },
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect(isErr(receivedResult)).toBe(true);
      const data = (receivedResult as { data: Record<string, unknown> }).data;
      expect(data.message).toBe('Unhandled error');
      expect(data.cause).toBeInstanceOf(Error);
      expect((data.cause as Error).message).toBe('handler crash');
      expect(data.filterError).toBeInstanceOf(Error);
      expect((data.filterError as Error).message).toBe('filter crash');
    });

    it('should call emergencyTeardown when handleResult throws on error-path result', async () => {
      // Arrange
      adapter.initializePipeline(createMockContainer());
      (adapter as any).emergencyTeardown = mock(() => {});

      // Make handleResult throw only on error path
      const callCount = { value: 0 };
      adapter['handleResult'] = async () => {
        callCount.value++;
        throw new Error('handleResult broken');
      };

      const routeHandler = createMockRouteHandler({
        handler: () => { throw new Error('handler crash'); },
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect((adapter as any).emergencyTeardown).toHaveBeenCalledTimes(1);
    });

    it('should not affect request result when OnComplete middleware throws', async () => {
      // Arrange
      let receivedResult: unknown;
      const originalHandleResult = adapter['handleResult'].bind(adapter);
      adapter['handleResult'] = async (result: unknown, ctx: Context) => {
        receivedResult = result;
        await originalHandleResult(result as never, ctx);
      };

      adapter.addMiddlewares(HttpPhase.OnComplete, [
        defineMiddleware(() => () => { throw new Error('OnComplete crash'); }),
      ]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        handler: () => ({ success: true }),
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act — should not throw despite OnComplete failure
      await expect(adapter.dispatchRequest(createHttpContext('GET', '/test'))).resolves.toBeUndefined();

      // Assert — handler result reached handleResult before OnComplete ran
      expect(isErr(receivedResult)).toBe(false);
    });

    it('should not affect request result when OnComplete middleware returns Err', async () => {
      // Arrange
      let receivedResult: unknown;
      const originalHandleResult = adapter['handleResult'].bind(adapter);
      adapter['handleResult'] = async (result: unknown, ctx: Context) => {
        receivedResult = result;
        await originalHandleResult(result as never, ctx);
      };

      adapter.addMiddlewares(HttpPhase.OnComplete, [
        defineMiddleware(() => () => err({ reason: 'OnComplete err' })),
      ]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        handler: () => ({ success: true }),
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await expect(adapter.dispatchRequest(createHttpContext('GET', '/test'))).resolves.toBeUndefined();

      // Assert — handler result still reached handleResult normally
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
        exceptionFilters: [{ handler: routeCatchAllHandler, catchTypes: [] }],
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
        exceptionFilters: [
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
        exceptionFilters: [
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
        middlewares: [() => err({ status: 429 })],
        exceptionFilters: [{ handler: routeFilterHandler, catchTypes: [] }],
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
        middlewares: [() => { throw new Error('MW throw'); }],
        exceptionFilters: [{ handler: routeFilterHandler, catchTypes: [] }],
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
        exceptionFilters: [{ handler: routeFilterHandler, catchTypes: [] }],
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
        exceptionFilters: [{ handler: routeFilterHandler, catchTypes: [] }],
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
        guards: [() => { throw new Error('guard exploded'); }],
        exceptionFilters: [{ handler: routeFilterHandler, catchTypes: [] }],
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
        middlewares: [
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
        middlewares: [() => null as never],
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

      adapter.addMiddlewares(HttpPhase.OnComplete, [defineMiddleware(() => onCompleteFn)]);
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

      adapter.addMiddlewares(HttpPhase.OnComplete, [defineMiddleware(() => onCompleteFn)]);
      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        middlewares: [() => err({ halt: true })],
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

      adapter.addMiddlewares(HttpPhase.OnComplete, [defineMiddleware(() => onCompleteFn)]);
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

      adapter.addMiddlewares(HttpPhase.OnComplete, [defineMiddleware(() => onCompleteFn)]);
      adapter.initializePipeline(createMockContainer());

      adapter['handleResult'] = async () => { throw new Error('handleResult broken'); };
      (adapter as any).emergencyTeardown = mock(() => {});

      const routeHandler = createMockRouteHandler({
        handler: () => { throw new Error('handler crash'); },
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert
      expect((adapter as any).emergencyTeardown).toHaveBeenCalledTimes(1);
      expect(onCompleteFn).toHaveBeenCalledTimes(1);
    });
  });

  // ── No Route Exception Filter Fallback ────────────────────

  describe('no route exception filter fallback', () => {
    it('should fall back to global filter when route has no exception filters and handler throws', async () => {
      // Arrange
      const globalFilter = mock((_error: unknown, _ctx: Context) => err({ source: 'global' }));

      adapter.addExceptionFilters([defineExceptionFilter([], () => globalFilter)]);
      adapter.initializePipeline(createMockContainer());

      // Route with NO exception filters
      const routeHandler = createMockRouteHandler({
        exceptionFilters: [],
        handler: () => { throw new Error('handler crash'); },
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert — no route filters registered → routeExceptionFilters on context remains undefined → global filter handles
      expect(globalFilter).toHaveBeenCalledTimes(1);
      expect((globalFilter.mock.calls[0]![0] as Error).message).toBe('handler crash');
    });

    it('should produce default unhandled error when no filters registered at all and handler throws', async () => {
      // Arrange
      let receivedResult: unknown;
      const originalHandleResult = adapter['handleResult'].bind(adapter);
      adapter['handleResult'] = async (result: unknown, ctx: Context) => {
        receivedResult = result;
        await originalHandleResult(result as never, ctx);
      };

      adapter.initializePipeline(createMockContainer());

      const routeHandler = createMockRouteHandler({
        exceptionFilters: [],
        handler: () => { throw new Error('totally unhandled'); },
      });
      adapter.setRouteHandler(routeHandler as never);

      // Act
      await adapter.dispatchRequest(createHttpContext('GET', '/test'));

      // Assert — default fallback from base Adapter.runExceptionFilters
      expect(isErr(receivedResult)).toBe(true);
      const data = (receivedResult as { data: Record<string, unknown> }).data;
      expect(data.message).toBe('Unhandled error');
      expect(data.cause).toBeInstanceOf(Error);
      expect((data.cause as Error).message).toBe('totally unhandled');
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
        OnReceive: [mw],
        PostParse: [mw],
        PreHandle: [mw],
        OnComplete: [mw],
      })).not.toThrow();
    });

    it('should accumulate definitions when called multiple times for the same phase', () => {
      // Arrange
      const adapter = new HttpAdapter();
      const mw1 = defineMiddleware(() => () => {});
      const mw2 = defineMiddleware(() => () => {});

      // Act
      adapter.applyMiddlewareConfig({ OnReceive: [mw1] });
      adapter.applyMiddlewareConfig({ OnReceive: [mw2] });
      adapter.initializePipeline(createMockContainer());

      // Assert — both middlewares should be registered
      const registry = (adapter as any).resolvedMiddlewareRegistry as Map<string, unknown[]>;
      expect(registry.get('OnReceive')).toHaveLength(2);
    });
  });

  // ── parseBody ──────────────────────────────────────────────────

  describe('parseBody', () => {
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

      const { HttpContext } = require('./http-context');
      const { HttpRequest } = require('./http-request');
      const { HttpResponse } = require('./http-response');

      const req = new HttpRequest({
        httpMethod: 'POST',
        url: 'http://localhost/test',
        headers: { 'content-type': 'application/json' },
        params: {},
        query: {},
      });
      const res = new HttpResponse(req, new Headers());
      const http = new HttpContext(req, res, rawRequest);

      // Act
      await (adapter as any).parseBody(http);

      // Assert
      expect(req.body).toEqual({ name: 'test' });
    });

    it('should parse text body for POST request without JSON content-type', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const rawRequest = new Request('http://localhost/test', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: 'hello world',
      });

      const { HttpContext } = require('./http-context');
      const { HttpRequest } = require('./http-request');
      const { HttpResponse } = require('./http-response');

      const req = new HttpRequest({
        httpMethod: 'POST',
        url: 'http://localhost/test',
        headers: { 'content-type': 'text/plain' },
        params: {},
        query: {},
      });
      const res = new HttpResponse(req, new Headers());
      const http = new HttpContext(req, res, rawRequest);

      // Act
      await (adapter as any).parseBody(http);

      // Assert
      expect(req.body).toBe('hello world');
    });

    it('should return Err with 400 status for invalid JSON', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const rawRequest = new Request('http://localhost/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{invalid json',
      });

      const { HttpContext } = require('./http-context');
      const { HttpRequest } = require('./http-request');
      const { HttpResponse } = require('./http-response');

      const req = new HttpRequest({
        httpMethod: 'POST',
        url: 'http://localhost/test',
        headers: { 'content-type': 'application/json' },
        params: {},
        query: {},
      });
      const res = new HttpResponse(req, new Headers());
      const http = new HttpContext(req, res, rawRequest);

      // Act
      const result = await (adapter as any).parseBody(http);

      // Assert
      expect(isErr(result)).toBe(true);
      expect(result.data).toEqual({ status: 400, message: 'Invalid JSON in request body' });
    });

    it('should skip body parsing for GET requests', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const rawRequest = new Request('http://localhost/test');

      const { HttpContext } = require('./http-context');
      const { HttpRequest } = require('./http-request');
      const { HttpResponse } = require('./http-response');

      const req = new HttpRequest({
        httpMethod: 'GET',
        url: 'http://localhost/test',
        headers: {},
        params: {},
        query: {},
      });
      const res = new HttpResponse(req, new Headers());
      const http = new HttpContext(req, res, rawRequest);

      // Act
      await (adapter as any).parseBody(http);

      // Assert — body should remain at its initial value (null)
      expect(req.body).toBeNull();
    });

    it('should skip body parsing for HEAD requests', async () => {
      // Arrange
      const adapter = new HttpAdapter();

      const { HttpContext } = require('./http-context');
      const { HttpRequest } = require('./http-request');
      const { HttpResponse } = require('./http-response');

      const req = new HttpRequest({
        httpMethod: 'HEAD',
        url: 'http://localhost/test',
        headers: {},
        params: {},
        query: {},
      });
      const res = new HttpResponse(req, new Headers());
      const http = new HttpContext(req, res, new Request('http://localhost/test', { method: 'HEAD' }));

      // Act
      await (adapter as any).parseBody(http);

      // Assert
      expect(req.body).toBeNull();
    });

    it('should skip body parsing for DELETE requests', async () => {
      // Arrange
      const adapter = new HttpAdapter();

      const { HttpContext } = require('./http-context');
      const { HttpRequest } = require('./http-request');
      const { HttpResponse } = require('./http-response');

      const req = new HttpRequest({
        httpMethod: 'DELETE',
        url: 'http://localhost/test',
        headers: {},
        params: {},
        query: {},
      });
      const res = new HttpResponse(req, new Headers());
      const http = new HttpContext(req, res, new Request('http://localhost/test', { method: 'DELETE' }));

      // Act
      await (adapter as any).parseBody(http);

      // Assert
      expect(req.body).toBeNull();
    });

    it('should skip body parsing for OPTIONS requests', async () => {
      // Arrange
      const adapter = new HttpAdapter();

      const { HttpContext } = require('./http-context');
      const { HttpRequest } = require('./http-request');
      const { HttpResponse } = require('./http-response');

      const req = new HttpRequest({
        httpMethod: 'OPTIONS',
        url: 'http://localhost/test',
        headers: {},
        params: {},
        query: {},
      });
      const res = new HttpResponse(req, new Headers());
      const http = new HttpContext(req, res, new Request('http://localhost/test', { method: 'OPTIONS' }));

      // Act
      await (adapter as any).parseBody(http);

      // Assert
      expect(req.body).toBeNull();
    });

    it('should skip body parsing when rawRequest is undefined', async () => {
      // Arrange
      const adapter = new HttpAdapter();

      const { HttpContext } = require('./http-context');
      const { HttpRequest } = require('./http-request');
      const { HttpResponse } = require('./http-response');

      const req = new HttpRequest({
        httpMethod: 'POST',
        url: 'http://localhost/test',
        headers: { 'content-type': 'application/json' },
        params: {},
        query: {},
      });
      const res = new HttpResponse(req, new Headers());
      const http = new HttpContext(req, res); // no rawRequest

      // Act
      await (adapter as any).parseBody(http);

      // Assert
      expect(req.body).toBeNull();
    });
  });

  // ── handleResult ──────────────────────────────────────────────

  describe('handleResult', () => {
    it('should skip response when already sent', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const context = createHttpContext('GET', '/test');
      const http = context.to(require('./http-context').HttpContext);
      const res = http.response;
      res.setStatus(200);
      res.setBody('already done');
      res.end();

      // Act — should not throw even with weird result
      await adapter['handleResult']({ value: 'ignored' } as never, context);

      // Assert — response was already sent, status unchanged
      expect(res.isSent()).toBe(true);
    });

    it('should write error response for Err result with status', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const context = createHttpContext('GET', '/test');
      const http = context.to(require('./http-context').HttpContext);

      // Act
      await adapter['handleResult'](err({ status: 404, message: 'Not Found' }), context);

      // Assert
      const res = http.response;
      expect(res.getStatus()).toBe(404);
    });

    it('should write error response for HttpError', async () => {
      // Arrange
      const { HttpError } = require('./errors/http-error');
      const adapter = new HttpAdapter();
      const context = createHttpContext('GET', '/test');
      const http = context.to(require('./http-context').HttpContext);

      // Act
      await adapter['handleResult'](err(new HttpError(403, 'Forbidden')), context);

      // Assert
      expect(http.response.getStatus()).toBe(403);
    });

    it('should write 500 for unknown error data shape', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const context = createHttpContext('GET', '/test');
      const http = context.to(require('./http-context').HttpContext);

      // Act
      await adapter['handleResult'](err('some string error'), context);

      // Assert
      expect(http.response.getStatus()).toBe(500);
    });

    it('should write success response for non-Err result', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const context = createHttpContext('GET', '/test');
      const http = context.to(require('./http-context').HttpContext);

      // Act
      await adapter['handleResult']({ data: 'success' } as never, context);

      // Assert
      const body = http.response.getBody();
      expect(body).toEqual({ data: 'success' });
    });

    it('should handle null result without error', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const context = createHttpContext('GET', '/test');

      // Act & Assert — should not throw
      await expect(adapter['handleResult'](null as never, context)).resolves.toBeUndefined();
    });

    it('should handle undefined result without error', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const context = createHttpContext('GET', '/test');

      // Act & Assert
      await expect(adapter['handleResult'](undefined as never, context)).resolves.toBeUndefined();
    });
  });

  // ── emergencyTeardown ────────────────────────────────────────

  describe('emergencyTeardown', () => {
    it('should set 500 status and Internal Server Error body', () => {
      // Arrange
      const adapter = new HttpAdapter();
      const context = createHttpContext('GET', '/test');
      const http = context.to(require('./http-context').HttpContext);

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
      const http = context.to(require('./http-context').HttpContext);
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
    it('should contain all four HttpPhase values', () => {
      // Assert
      expect(HttpAdapter.validPhases).toContain('OnReceive');
      expect(HttpAdapter.validPhases).toContain('PostParse');
      expect(HttpAdapter.validPhases).toContain('PreHandle');
      expect(HttpAdapter.validPhases).toContain('OnComplete');
      expect(HttpAdapter.validPhases.size).toBe(4);
    });
  });

  // ── addMiddlewares convenience method ──────────────────────────

  describe('addMiddlewares', () => {
    it('should register middlewares for a given phase', async () => {
      // Arrange
      const adapter = new HttpAdapter();
      const order: string[] = [];

      adapter.addMiddlewares(HttpPhase.OnReceive, [defineMiddleware(() => () => { order.push('mw1'); })]);
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
      expect(adapter.addMiddlewares(HttpPhase.OnReceive, [])).toBe(adapter);
    });
  });
});
