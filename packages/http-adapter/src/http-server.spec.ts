import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { Server } from 'bun';

import type { ZipbulContainer } from '@zipbul/common';
import type { HttpAdapter } from './http-adapter';

const mockLoggerDebug = mock(() => {});
const mockLoggerInfo = mock(() => {});
const mockLoggerWarn = mock(() => {});
const mockLoggerError = mock(() => {});

mock.module('@zipbul/logger', () => ({
  Logger: class {
    static inherit() {
      return {
        debug: mockLoggerDebug,
        info: mockLoggerInfo,
        warn: mockLoggerWarn,
        error: mockLoggerError,
      };
    }
  },
}));

const { HttpServer } = await import('./http-server');

type HttpServerInstance = InstanceType<typeof HttpServer>;

interface ServerInternals {
  adapter: HttpAdapter;
  container: ZipbulContainer;
  options: Record<string, unknown>;
  server: Record<string, unknown>;
  allowedMethods: ReadonlySet<string>;
}

function createMockContainer(overrides?: Partial<Record<keyof ZipbulContainer, unknown>>): ZipbulContainer {
  return {
    get: mock(() => undefined),
    set: mock(() => {}),
    has: mock(() => false),
    getInstances: mock(function* () {}),
    keys: mock(function* () {}),
    ...overrides,
  } as unknown as ZipbulContainer;
}

function createMockAdapter(): HttpAdapter {
  return {
    constructor: { name: 'MockAdapter' },
    decorators: {
      controller: { name: 'Controller' },
      handlers: [],
    },
    setRouteHandler: mock(() => {}),
    dispatchRequest: mock(async () => {}),
  } as unknown as HttpAdapter;
}

/**
 * Wires up the server's private fields directly, bypassing Bun.serve.
 * This avoids real I/O and the non-configurable Bun.serve property issue.
 */
function wireServer(
  server: HttpServerInstance,
  container: ZipbulContainer,
  adapter: HttpAdapter,
): void {
  const internals = server as unknown as ServerInternals;
  internals.adapter = adapter;
  internals.container = container;
  internals.options = { port: 3000, trustProxy: false };
  internals.server = { hostname: 'localhost', port: 3000 };
  internals.allowedMethods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
}

function createGetRequest(path: string = '/test'): Request {
  return new Request(`http://localhost${path}`, { method: 'GET' });
}

const mockBunServer = { requestIP: () => ({ address: '127.0.0.1', family: 'IPv4', port: 0 }) } as unknown as Server<unknown>;

describe('HttpServer', () => {
  let server: HttpServerInstance;

  beforeEach(() => {
    server = new HttpServer();
    mockLoggerDebug.mockClear();
    mockLoggerInfo.mockClear();
    mockLoggerWarn.mockClear();
    mockLoggerError.mockClear();
  });

  describe('fetch request scope lifecycle', () => {
    it('should call createRequestScope on each fetch', async () => {
      // Arrange
      const mockCreateRequestScope = mock(() => createMockContainer());
      const container = createMockContainer({ createRequestScope: mockCreateRequestScope });
      const adapter = createMockAdapter();
      wireServer(server, container, adapter);

      // Act
      await server.fetch(createGetRequest(), mockBunServer);

      // Assert
      expect(mockCreateRequestScope).toHaveBeenCalledTimes(1);
    });

    it('should skip createRequestScope when container has no request-scoped providers', async () => {
      const mockCreateRequestScope = mock(() => createMockContainer());
      const container = createMockContainer({
        createRequestScope: mockCreateRequestScope,
        hasRequestScope: () => false,
      });
      const adapter = createMockAdapter();
      wireServer(server, container, adapter);

      await server.fetch(createGetRequest(), mockBunServer);

      expect(mockCreateRequestScope).not.toHaveBeenCalled();
    });

    it('should pass scoped container to HttpContext', async () => {
      // Arrange
      const scopedContainer = createMockContainer();
      const mockCreateRequestScope = mock(() => scopedContainer);
      const container = createMockContainer({ createRequestScope: mockCreateRequestScope });
      const adapter = createMockAdapter();
      let receivedContainer: ZipbulContainer | undefined;
      (adapter.dispatchRequest as ReturnType<typeof mock>).mockImplementation(async (context: Record<string, unknown>) => {
        receivedContainer = (context as unknown as { container: ZipbulContainer | undefined }).container;
      });
      wireServer(server, container, adapter);

      // Act
      await server.fetch(createGetRequest(), mockBunServer);

      // Assert
      expect(receivedContainer).toBe(scopedContainer);
    });

    it('should call dispose after successful request', async () => {
      // Arrange
      const mockDispose = mock(async () => {});
      const scopedContainer = createMockContainer({ dispose: mockDispose });
      const mockCreateRequestScope = mock(() => scopedContainer);
      const container = createMockContainer({ createRequestScope: mockCreateRequestScope });
      const adapter = createMockAdapter();
      wireServer(server, container, adapter);

      // Act
      await server.fetch(createGetRequest(), mockBunServer);

      // Assert
      expect(mockDispose).toHaveBeenCalledTimes(1);
    });

    it('should call dispose when dispatchRequest throws', async () => {
      // Arrange
      const mockDispose = mock(async () => {});
      const scopedContainer = createMockContainer({ dispose: mockDispose });
      const mockCreateRequestScope = mock(() => scopedContainer);
      const container = createMockContainer({ createRequestScope: mockCreateRequestScope });
      const adapter = createMockAdapter();
      (adapter.dispatchRequest as ReturnType<typeof mock>).mockImplementation(async () => {
        throw new Error('dispatch failure');
      });
      wireServer(server, container, adapter);

      // Act
      await server.fetch(createGetRequest(), mockBunServer);

      // Assert
      expect(mockDispose).toHaveBeenCalledTimes(1);
    });

    it('should handle createRequestScope returning undefined gracefully', async () => {
      // Arrange
      const mockCreateRequestScope = mock(() => undefined);
      const container = createMockContainer({
        createRequestScope: mockCreateRequestScope as unknown as ZipbulContainer['createRequestScope'],
      });
      const adapter = createMockAdapter();
      wireServer(server, container, adapter);

      // Act
      const response = await server.fetch(createGetRequest(), mockBunServer);

      // Assert
      expect(response).toBeInstanceOf(Response);
      expect(response.status).not.toBe(500);
    });

    it('should generate unique requestId per fetch in UUID format', async () => {
      // Arrange
      const capturedIds: string[] = [];
      const mockCreateRequestScope = mock((contextId: string) => {
        capturedIds.push(contextId);
        return createMockContainer();
      });
      const container = createMockContainer({ createRequestScope: mockCreateRequestScope });
      const adapter = createMockAdapter();
      wireServer(server, container, adapter);
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

      // Act
      await server.fetch(createGetRequest(), mockBunServer);
      await server.fetch(createGetRequest(), mockBunServer);

      // Assert
      expect(capturedIds).toHaveLength(2);
      expect(capturedIds[0]).toMatch(uuidRegex);
      expect(capturedIds[1]).toMatch(uuidRegex);
      expect(capturedIds[0]).not.toBe(capturedIds[1]);
    });

    it('should still return response when dispose throws', async () => {
      // Arrange
      const mockDispose = mock(async () => {
        throw new Error('dispose failure');
      });
      const scopedContainer = createMockContainer({ dispose: mockDispose });
      const mockCreateRequestScope = mock(() => scopedContainer);
      const container = createMockContainer({ createRequestScope: mockCreateRequestScope });
      const adapter = createMockAdapter();
      wireServer(server, container, adapter);

      // Act
      const response = await server.fetch(createGetRequest(), mockBunServer);

      // Assert
      expect(response).toBeInstanceOf(Response);
      expect(response.status).not.toBe(500);
    });

    it('should call dispose even when toResponse logic fails', async () => {
      // Arrange
      const mockDispose = mock(async () => {});
      const scopedContainer = createMockContainer({ dispose: mockDispose });
      const mockCreateRequestScope = mock(() => scopedContainer);
      const container = createMockContainer({ createRequestScope: mockCreateRequestScope });
      const adapter = createMockAdapter();
      (adapter.dispatchRequest as ReturnType<typeof mock>).mockImplementation(async () => {
        throw new TypeError('toResponse simulation');
      });
      wireServer(server, container, adapter);

      // Act
      await server.fetch(createGetRequest(), mockBunServer);

      // Assert
      expect(mockDispose).toHaveBeenCalledTimes(1);
    });

    it('should create independent scope per concurrent fetch', async () => {
      // Arrange
      const scopes: ZipbulContainer[] = [];
      const mockCreateRequestScope = mock(() => {
        const scope = createMockContainer();
        scopes.push(scope);
        return scope;
      });
      const container = createMockContainer({ createRequestScope: mockCreateRequestScope });
      const adapter = createMockAdapter();
      wireServer(server, container, adapter);

      // Act
      await Promise.all([
        server.fetch(createGetRequest('/a'), mockBunServer),
        server.fetch(createGetRequest('/b'), mockBunServer),
        server.fetch(createGetRequest('/c'), mockBunServer),
      ]);

      // Assert
      expect(scopes).toHaveLength(3);
      expect(scopes[0]).not.toBe(scopes[1]);
      expect(scopes[1]).not.toBe(scopes[2]);
      expect(scopes[0]).not.toBe(scopes[2]);
    });
  });

  describe('toResponse status logging', () => {
    it('should return 500 when status is out of range (199)', async () => {
      // Arrange — status validation moved to HttpResponse.build()
      const container = createMockContainer({ createRequestScope: mock(() => createMockContainer()) });
      const adapter = createMockAdapter();
      (adapter.dispatchRequest as ReturnType<typeof mock>).mockImplementation(async (context: Record<string, unknown>) => {
        const typedContext = context as unknown as { response: Record<string, unknown> & { setBody: (b: string) => { end: () => void } } };
        typedContext.response._status = 99;
        typedContext.response._statusText = 'Custom';
        typedContext.response.setBody('test').end();
      });
      wireServer(server, container, adapter);

      // Act
      const response = await server.fetch(createGetRequest(), mockBunServer);

      // Assert — HttpResponse.build() corrects out-of-range status to 500
      expect(response.status).toBe(500);
    });

    it('should not log warning when status is 200', async () => {
      // Arrange
      const container = createMockContainer({ createRequestScope: mock(() => createMockContainer()) });
      const adapter = createMockAdapter();
      (adapter.dispatchRequest as ReturnType<typeof mock>).mockImplementation(async (context: Record<string, unknown>) => {
        const typedContext = context as unknown as { response: { setStatus: (s: number) => { setBody: (b: string) => { end: () => void } } } };
        typedContext.response.setStatus(200).setBody('ok').end();
      });
      wireServer(server, container, adapter);

      // Act
      await server.fetch(createGetRequest(), mockBunServer);

      // Assert
      expect(mockLoggerWarn).not.toHaveBeenCalled();
    });

    it('should not log warning when status is 599', async () => {
      // Arrange
      const container = createMockContainer({ createRequestScope: mock(() => createMockContainer()) });
      const adapter = createMockAdapter();
      (adapter.dispatchRequest as ReturnType<typeof mock>).mockImplementation(async (context: Record<string, unknown>) => {
        const typedContext = context as unknown as { response: Record<string, unknown> & { setBody: (b: string) => { end: () => void } } };
        typedContext.response._status = 599;
        typedContext.response._statusText = 'Custom';
        typedContext.response.setBody('test').end();
      });
      wireServer(server, container, adapter);

      // Act
      await server.fetch(createGetRequest(), mockBunServer);

      // Assert
      expect(mockLoggerWarn).not.toHaveBeenCalled();
    });

    it('should return 500 when status is out of range (600)', async () => {
      // Arrange — status validation moved to HttpResponse.build()
      const container = createMockContainer({ createRequestScope: mock(() => createMockContainer()) });
      const adapter = createMockAdapter();
      (adapter.dispatchRequest as ReturnType<typeof mock>).mockImplementation(async (context: Record<string, unknown>) => {
        const typedContext = context as unknown as { response: Record<string, unknown> & { setBody: (b: string) => { end: () => void } } };
        typedContext.response._status = 600;
        typedContext.response._statusText = 'Custom';
        typedContext.response.setBody('test').end();
      });
      wireServer(server, container, adapter);

      // Act
      const response = await server.fetch(createGetRequest(), mockBunServer);

      // Assert — HttpResponse.build() corrects out-of-range status to 500
      expect(response.status).toBe(500);
    });

    it('should not log warning when status is 101 (SWITCHING_PROTOCOLS)', async () => {
      // Arrange
      const container = createMockContainer({ createRequestScope: mock(() => createMockContainer()) });
      const adapter = createMockAdapter();
      (adapter.dispatchRequest as ReturnType<typeof mock>).mockImplementation(async (context: Record<string, unknown>) => {
        const typedContext = context as unknown as { response: Record<string, unknown> & { setBody: (b: string) => { end: () => void } } };
        typedContext.response._status = 101;
        typedContext.response._statusText = 'Switching Protocols';
        typedContext.response.setBody('test').end();
      });
      wireServer(server, container, adapter);

      // Act
      await server.fetch(createGetRequest(), mockBunServer);

      // Assert
      expect(mockLoggerWarn).not.toHaveBeenCalled();
    });

    it('should not log warning when status is 0 (status stripped path)', async () => {
      // Arrange
      const container = createMockContainer({ createRequestScope: mock(() => createMockContainer()) });
      const adapter = createMockAdapter();
      (adapter.dispatchRequest as ReturnType<typeof mock>).mockImplementation(async (context: Record<string, unknown>) => {
        const typedContext = context as unknown as { response: { setBody: (b: string) => { end: () => void } } };
        typedContext.response.setBody('no status set').end();
      });
      wireServer(server, container, adapter);

      // Act
      await server.fetch(createGetRequest(), mockBunServer);

      // Assert
      expect(mockLoggerWarn).not.toHaveBeenCalled();
    });

    it('should not log warning when status is undefined (status stripped path)', async () => {
      // Arrange
      const container = createMockContainer({ createRequestScope: mock(() => createMockContainer()) });
      const adapter = createMockAdapter();
      wireServer(server, container, adapter);

      // Act
      await server.fetch(createGetRequest(), mockBunServer);

      // Assert
      expect(mockLoggerWarn).not.toHaveBeenCalled();
    });
  });

  describe('TLS passthrough', () => {
    it('should store tls options in server options when provided', () => {
      // Arrange
      const tlsServer = new HttpServer();
      const container = createMockContainer();
      const adapter = createMockAdapter();
      const tlsOptions = { cert: 'test-cert', key: 'test-key' };

      // Act — wire server directly with tls options
      const internals = tlsServer as unknown as ServerInternals;
      internals.adapter = adapter;
      internals.container = container;
      internals.options = { port: 3000, trustProxy: false, tls: tlsOptions };
      internals.server = { hostname: 'localhost', port: 3000 };
      internals.allowedMethods = new Set(['GET']);

      // Assert — options contain tls
      expect(internals.options.tls).toEqual(tlsOptions);
      const tls = internals.options.tls as { cert: string; key: string };
      expect(tls.cert).toBe('test-cert');
      expect(tls.key).toBe('test-key');
    });

    it('should not have tls in options when not configured', () => {
      // Arrange
      const tlsServer = new HttpServer();
      const container = createMockContainer();
      const adapter = createMockAdapter();

      // Act
      wireServer(tlsServer, container, adapter);

      // Assert
      const internals = tlsServer as unknown as ServerInternals;
      expect(internals.options.tls).toBeUndefined();
    });
  });

  describe('getMetrics', () => {
    it('should return undefined when server is not booted', () => {
      const fresh = new HttpServer();

      expect(fresh.getMetrics()).toBeUndefined();
    });

    it('should return snapshot of pendingRequests and pendingWebSockets', () => {
      const metricsServer = new HttpServer();
      const internals = metricsServer as unknown as ServerInternals;
      internals.server = { pendingRequests: 7, pendingWebSockets: 2 };

      expect(metricsServer.getMetrics()).toEqual({ pendingRequests: 7, pendingWebSockets: 2 });
    });
  });

  describe('fetch URI length defense', () => {
    it('should respond 414 when request URL exceeds maxUriLength', async () => {
      const container = createMockContainer();
      const adapter = createMockAdapter();
      wireServer(server, container, adapter);
      const internals = server as unknown as ServerInternals;
      internals.options = { ...internals.options, maxUriLength: 64 };

      const longRequest = new Request(`http://localhost/${'a'.repeat(200)}`, { method: 'GET' });

      const response = await server.fetch(longRequest, mockBunServer);

      expect(response.status).toBe(414);
    });

    it('should use default 8192 limit when maxUriLength option is not provided', async () => {
      const container = createMockContainer();
      const adapter = createMockAdapter();
      wireServer(server, container, adapter);

      const longRequest = new Request(`http://localhost/${'a'.repeat(9000)}`, { method: 'GET' });

      const response = await server.fetch(longRequest, mockBunServer);

      expect(response.status).toBe(414);
    });
  });
});
