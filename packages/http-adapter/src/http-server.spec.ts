import { describe, it, expect, mock, beforeEach, spyOn } from 'bun:test';

import type { ZipbulContainer } from '@zipbul/common';
import type { HttpAdapter } from './http-adapter';
import type { HttpWorkerResponse } from './interfaces';

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

mock.module('./utils', () => ({
  getIps: mock(() => ({ ip: '127.0.0.1', ips: [] })),
}));

const { HttpServer } = await import('./http-server');

type HttpServerInstance = InstanceType<typeof HttpServer>;

interface ServerInternals {
  adapter: HttpAdapter;
  container: ZipbulContainer;
  options: Record<string, unknown>;
  server: Record<string, unknown>;
}

function createMockContainer(overrides?: Partial<ZipbulContainer>): ZipbulContainer {
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
}

function createGetRequest(path: string = '/test'): Request {
  return new Request(`http://localhost${path}`, { method: 'GET' });
}

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
      await server.fetch(createGetRequest());

      // Assert
      expect(mockCreateRequestScope).toHaveBeenCalledTimes(1);
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
      await server.fetch(createGetRequest());

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
      await server.fetch(createGetRequest());

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
      await server.fetch(createGetRequest());

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
      const response = await server.fetch(createGetRequest());

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
      await server.fetch(createGetRequest());
      await server.fetch(createGetRequest());

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
      const response = await server.fetch(createGetRequest());

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
      await server.fetch(createGetRequest());

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
        server.fetch(createGetRequest('/a')),
        server.fetch(createGetRequest('/b')),
        server.fetch(createGetRequest('/c')),
      ]);

      // Assert
      expect(scopes).toHaveLength(3);
      expect(scopes[0]).not.toBe(scopes[1]);
      expect(scopes[1]).not.toBe(scopes[2]);
      expect(scopes[0]).not.toBe(scopes[2]);
    });
  });

  describe('toResponse status logging', () => {
    it('should log warning when status is 199', async () => {
      // Arrange
      const container = createMockContainer({ createRequestScope: mock(() => createMockContainer()) });
      const adapter = createMockAdapter();
      (adapter.dispatchRequest as ReturnType<typeof mock>).mockImplementation(async (context: Record<string, unknown>) => {
        const typedContext = context as unknown as { response: Record<string, unknown> & { setBody: (b: string) => { end: () => void } } };
        typedContext.response._status = 199;
        typedContext.response._statusText = 'Custom';
        typedContext.response.setBody('test').end();
      });
      wireServer(server, container, adapter);

      // Act
      const response = await server.fetch(createGetRequest());

      // Assert
      expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
      expect(mockLoggerWarn.mock.calls[0][0]).toContain('199');
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
      await server.fetch(createGetRequest());

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
      await server.fetch(createGetRequest());

      // Assert
      expect(mockLoggerWarn).not.toHaveBeenCalled();
    });

    it('should log warning when status is 600', async () => {
      // Arrange
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
      const response = await server.fetch(createGetRequest());

      // Assert
      expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
      expect(mockLoggerWarn.mock.calls[0][0]).toContain('600');
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
      await server.fetch(createGetRequest());

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
      await server.fetch(createGetRequest());

      // Assert
      expect(mockLoggerWarn).not.toHaveBeenCalled();
    });

    it('should not log warning when status is undefined (status stripped path)', async () => {
      // Arrange
      const container = createMockContainer({ createRequestScope: mock(() => createMockContainer()) });
      const adapter = createMockAdapter();
      wireServer(server, container, adapter);

      // Act
      await server.fetch(createGetRequest());

      // Assert
      expect(mockLoggerWarn).not.toHaveBeenCalled();
    });
  });
});
