import { describe, it, expect, mock, beforeEach, spyOn } from 'bun:test';
import type { Context } from '@zipbul/common';
import { err, isErr } from '@zipbul/common';

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

  // ── resolveManifestPath ─────────────────────────────────

  describe('resolveManifestPath', () => {
    it('should return empty string when not in AOT runtime', () => {
      // Arrange
      mockGetRuntimeContext.mockReturnValueOnce({ isAotRuntime: false });
      const adapter = new HttpAdapter();

      // Act
      const result = (adapter as unknown as Record<string, () => string>).resolveManifestPath();

      // Assert
      expect(result).toBe('');
    });

    it('should return runtime.js path for .js entry in AOT mode', () => {
      // Arrange
      mockGetRuntimeContext.mockReturnValueOnce({ isAotRuntime: true });
      const originalArgv1 = Bun.argv[1];
      Bun.argv[1] = '/app/dist/entry.js';
      const adapter = new HttpAdapter();

      // Act
      const result = (adapter as unknown as Record<string, () => string>).resolveManifestPath();

      // Assert
      expect(result).toBe('/app/dist/runtime.js');

      // Cleanup
      Bun.argv[1] = originalArgv1;
    });

    it('should return runtime.ts path for .ts entry in AOT mode', () => {
      // Arrange
      mockGetRuntimeContext.mockReturnValueOnce({ isAotRuntime: true });
      const originalArgv1 = Bun.argv[1];
      Bun.argv[1] = '/app/.zipbul/entry.ts';
      const adapter = new HttpAdapter();

      // Act
      const result = (adapter as unknown as Record<string, () => string>).resolveManifestPath();

      // Assert
      expect(result).toBe('/app/.zipbul/runtime.ts');

      // Cleanup
      Bun.argv[1] = originalArgv1;
    });

    it('should handle nested directory paths', () => {
      // Arrange
      mockGetRuntimeContext.mockReturnValueOnce({ isAotRuntime: true });
      const originalArgv1 = Bun.argv[1];
      Bun.argv[1] = '/a/b/c/entry.js';
      const adapter = new HttpAdapter();

      // Act
      const result = (adapter as unknown as Record<string, () => string>).resolveManifestPath();

      // Assert
      expect(result).toBe('/a/b/c/runtime.js');

      // Cleanup
      Bun.argv[1] = originalArgv1;
    });

    it('should return ./runtime.ext for bare filename without directory', () => {
      // Arrange
      mockGetRuntimeContext.mockReturnValueOnce({ isAotRuntime: true });
      const originalArgv1 = Bun.argv[1];
      Bun.argv[1] = 'entry.js';
      const adapter = new HttpAdapter();

      // Act
      const result = (adapter as unknown as Record<string, () => string>).resolveManifestPath();

      // Assert
      expect(result).toBe('./runtime.js');

      // Cleanup
      Bun.argv[1] = originalArgv1;
    });

    it('should return empty string when Bun.argv[1] is undefined and not AOT', () => {
      // Arrange
      mockGetRuntimeContext.mockReturnValueOnce({ isAotRuntime: false });
      const adapter = new HttpAdapter();

      // Act
      const result = (adapter as unknown as Record<string, () => string>).resolveManifestPath();

      // Assert
      expect(result).toBe('');
    });

    it('should resolve root path entry correctly', () => {
      // Arrange
      mockGetRuntimeContext.mockReturnValueOnce({ isAotRuntime: true });
      const originalArgv1 = Bun.argv[1];
      Bun.argv[1] = '/entry.js';
      const adapter = new HttpAdapter();

      // Act
      const result = (adapter as unknown as Record<string, () => string>).resolveManifestPath();

      // Assert
      expect(result).toBe('/runtime.js');

      // Cleanup
      Bun.argv[1] = originalArgv1;
    });
  });

  // ── Route-Level Guard Execution ─────────────────────────

  describe('resolveHandler route-level guards', () => {
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
            errorFilters: [],
            guards: [],
            paramFactory: mock(async () => []),
          },
        })),
      };
      adapter.setRouteHandler(mockRouteHandler as never);

      const context = createHttpContext('GET', '/test');

      // Act
      const result = await adapter.resolveHandler(context);

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
            errorFilters: [],
            guards: [{ handler: guardHandler }],
            paramFactory: mock(async () => []),
          },
        })),
      };
      adapter.setRouteHandler(mockRouteHandler as never);

      const context = createHttpContext('GET', '/test');

      // Act
      const result = await adapter.resolveHandler(context);

      // Assert
      expect(guardHandler).toHaveBeenCalledTimes(1);
      expect(handlerFn).toHaveBeenCalled();
    });

    it('should return Err and skip handler when guard denies', async () => {
      // Arrange
      const guardHandler = mock(() => err({ status: 403, message: 'Forbidden' }));
      const handlerFn = mock(() => ({ data: 'ok' }));
      const mockRouteHandler = {
        match: mock(() => ({
          params: {},
          value: {
            handler: handlerFn,
            methodName: 'test',
            middlewares: [],
            errorFilters: [],
            guards: [{ handler: guardHandler }],
            paramFactory: mock(async () => []),
          },
        })),
      };
      adapter.setRouteHandler(mockRouteHandler as never);

      const context = createHttpContext('GET', '/test');

      // Act
      const result = await adapter.resolveHandler(context);

      // Assert
      expect(isErr(result)).toBe(true);
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
            errorFilters: [],
            guards: [{ handler: guard1 }, { handler: guard2 }],
            paramFactory: mock(async () => []),
          },
        })),
      };
      adapter.setRouteHandler(mockRouteHandler as never);

      const context = createHttpContext('GET', '/test');

      // Act
      await adapter.resolveHandler(context);

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
            errorFilters: [],
            guards: [{ handler: guard1 }, { handler: guard2 }],
            paramFactory: mock(async () => []),
          },
        })),
      };
      adapter.setRouteHandler(mockRouteHandler as never);

      const context = createHttpContext('GET', '/test');

      // Act
      await adapter.resolveHandler(context);

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
            errorFilters: [],
            guards: [{ handler: guardHandler }],
            paramFactory: mock(async () => []),
          },
        })),
      };
      adapter.setRouteHandler(mockRouteHandler as never);

      const context = createHttpContext('GET', '/test');

      // Act
      const result = await adapter.resolveHandler(context);

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
            errorFilters: [],
            guards: [{ handler: guardHandler }],
            paramFactory: mock(async () => []),
          },
        })),
      };
      adapter.setRouteHandler(mockRouteHandler as never);

      const context = createHttpContext('GET', '/test');

      // Act
      await adapter.resolveHandler(context);

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
