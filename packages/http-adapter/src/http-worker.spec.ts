import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { CompiledHandlerEntry, ZipbulContainer } from '@zipbul/common';
import { MiddlewareHook } from '@zipbul/common';

// ── Mock: @zipbul/core ──────────────────────────────────────────────

const mockGetRuntimeContext = mock(() => ({} as Record<string, unknown>));
const mockExpose = mock(() => undefined);

class MockClusterBaseWorker {
  protected id = 0;
  protected prevCpu = process.cpuUsage();

  async init(id: number, _params: unknown) {
    this.id = id;
    this.prevCpu = process.cpuUsage();
    await Promise.resolve();
  }

  getStats() {
    return { cpu: 0, memory: 0 };
  }
}

class MockContainer {
  private readonly store = new Map<string, unknown>();

  get(token: string): unknown {
    if (this.store.has(token)) {
      return this.store.get(token);
    }
    throw new Error(`No provider for: ${token}`);
  }

  set(token: string, value: unknown): void {
    this.store.set(token, value);
  }

  has(): boolean {
    return false;
  }

  *getInstances(): Generator<unknown> {}

  *keys(): Generator<string> {}

  setScopedKeys(): void {}
}

mock.module('@zipbul/core', () => ({
  ClusterBaseWorker: MockClusterBaseWorker,
  ClusterManager: class {},
  Container: MockContainer,
  expose: mockExpose,
  getRuntimeContext: mockGetRuntimeContext,
}));

// ── Mock: @zipbul/logger ────────────────────────────────────────────

const mockLoggerWarn = mock();

mock.module('@zipbul/logger', () => ({
  Logger: class {
    static runScoped(_logger: unknown, fn: () => unknown) {
      return fn();
    }

    debug() {}
    info() {}
    warn(...args: unknown[]) {
      mockLoggerWarn(...args);
    }
    error() {}
  },
}));

// ── Mock: ./http-adapter ────────────────────────────────────────────

const mockAddMiddlewares = mock();
const mockAddExceptionFilterEntries = mock();
const mockAddGuards = mock();

mock.module('./http-adapter', () => ({
  HttpAdapter: class HttpAdapter {
    readonly decorators = {
      controller: function RestController() {},
      handlers: [function Get() {}, function Post() {}, function Put() {}, function Delete() {}, function Patch() {}, function Options() {}, function Head() {}],
    };

    addMiddlewares = mockAddMiddlewares;
    addExceptionFilterEntries = mockAddExceptionFilterEntries;
    addGuards = mockAddGuards;

    constructor(public options?: unknown) {}
  },
}));

// ── Mock: ./http-server ─────────────────────────────────────────────

const mockBoot = mock(async () => undefined);

mock.module('./http-server', () => ({
  HttpServer: class {
    boot = mockBoot;
  },
}));

// ── Import SUT (after all mocks) ────────────────────────────────────

const { HttpWorker } = await import('./http-worker');

// ── Helpers ─────────────────────────────────────────────────────────

function createHandlerEntry(overrides: Partial<CompiledHandlerEntry> = {}): CompiledHandlerEntry {
  return {
    id: 'HttpAdapter:test#Ctrl.method',
    adapterId: 'HttpAdapter',
    controllerKey: 'TestModule::TestController',
    methodName: 'handle',
    handlerDecorator: 'Get',
    handlerDecoratorArgs: ['/test'],
    params: [],
    middlewareKeys: [],
    errorFilterKeys: [],
    guardKeys: [],
    ...overrides,
  };
}

function createValidInitParams(manifestPath?: string) {
  return {
    entryModule: {
      className: 'AppModule',
      ...(manifestPath !== undefined ? { manifestPath } : {}),
    },
    options: { port: 3000 },
  };
}

function createContainerWithEntries(entries: Record<string, unknown>): MockContainer {
  const container = new MockContainer();

  for (const [key, value] of Object.entries(entries)) {
    container.set(key, value);
  }

  return container;
}

// ── Tests ───────────────────────────────────────────────────────────

describe('HttpWorker', () => {
  beforeEach(() => {
    mockGetRuntimeContext.mockReset();
    mockExpose.mockClear();
    mockLoggerWarn.mockClear();
    mockAddMiddlewares.mockClear();
    mockAddExceptionFilterEntries.mockClear();
    mockAddGuards.mockClear();
    mockBoot.mockClear();

    mockGetRuntimeContext.mockReturnValue({});
  });

  // ── buildControllerInstances (via initInternal) ───────────────────

  describe('buildControllerInstances', () => {
    it('should return empty Map for empty handlerIndex', async () => {
      // Arrange
      mockGetRuntimeContext.mockReturnValue({
        handlerIndex: [],
      });
      const worker = new HttpWorker();

      // Act
      await worker.init(1, createValidInitParams());

      // Assert — boot is called with options that do NOT include controllerInstances
      const bootOptions = mockBoot.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(bootOptions.controllerInstances).toBeUndefined();
    });

    it('should resolve controller instances from container via get()', async () => {
      // Arrange
      const controllerInstance = { name: 'TestController' };
      const container = createContainerWithEntries({
        'TestModule::TestController': controllerInstance,
      });

      mockGetRuntimeContext.mockReturnValue({
        container,
        handlerIndex: [createHandlerEntry()],
      });
      const worker = new HttpWorker();

      // Act
      await worker.init(1, createValidInitParams());

      // Assert
      const bootOptions = mockBoot.mock.calls[0]?.[1] as Record<string, unknown>;
      const instances = bootOptions.controllerInstances as Map<string, unknown>;
      expect(instances).toBeInstanceOf(Map);
      expect(instances.get('TestModule::TestController')).toBe(controllerInstance);
    });

    it('should deduplicate when multiple entries share same controllerKey', async () => {
      // Arrange
      const controllerInstance = { name: 'SharedController' };
      const sharedKey = 'TestModule::SharedController';
      const container = createContainerWithEntries({
        [sharedKey]: controllerInstance,
      });

      mockGetRuntimeContext.mockReturnValue({
        container,
        handlerIndex: [
          createHandlerEntry({ controllerKey: sharedKey, methodName: 'findAll' }),
          createHandlerEntry({ controllerKey: sharedKey, methodName: 'findOne' }),
        ],
      });
      const worker = new HttpWorker();

      // Act
      await worker.init(1, createValidInitParams());

      // Assert
      const bootOptions = mockBoot.mock.calls[0]?.[1] as Record<string, unknown>;
      const instances = bootOptions.controllerInstances as Map<string, unknown>;
      expect(instances.size).toBe(1);
      expect(instances.get(sharedKey)).toBe(controllerInstance);
    });

    it('should log warning and continue when container.get throws', async () => {
      // Arrange
      const container = new MockContainer();

      mockGetRuntimeContext.mockReturnValue({
        container,
        handlerIndex: [createHandlerEntry({ controllerKey: 'Missing::Controller' })],
      });
      const worker = new HttpWorker();

      // Act
      await worker.init(1, createValidInitParams());

      // Assert
      expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
      const warnMessage = mockLoggerWarn.mock.calls[0]?.[0] as string;
      expect(warnMessage).toContain('Missing::Controller');
      // Boot should still be called (worker continues)
      expect(mockBoot).toHaveBeenCalledTimes(1);
    });

    it('should store null value when container.get returns null', async () => {
      // Arrange
      const container = createContainerWithEntries({
        'TestModule::NullController': null,
      });

      mockGetRuntimeContext.mockReturnValue({
        container,
        handlerIndex: [createHandlerEntry({ controllerKey: 'TestModule::NullController' })],
      });
      const worker = new HttpWorker();

      // Act
      await worker.init(1, createValidInitParams());

      // Assert
      const bootOptions = mockBoot.mock.calls[0]?.[1] as Record<string, unknown>;
      const instances = bootOptions.controllerInstances as Map<string, unknown>;
      expect(instances.has('TestModule::NullController')).toBe(true);
      expect(instances.get('TestModule::NullController')).toBeNull();
    });
  });

  // ── initInternal flow ─────────────────────────────────────────────

  describe('initInternal', () => {
    it('should call dynamic import when manifestPath is provided', async () => {
      // Arrange
      const manifestPath = '/tmp/test-manifest.js';
      mock.module(manifestPath, () => ({}));
      mockGetRuntimeContext.mockReturnValue({});
      const worker = new HttpWorker();

      // Act — no throw means import was called successfully
      await worker.init(1, createValidInitParams(manifestPath));

      // Assert — if manifestPath was invalid/not-mocked, init would throw
      expect(mockBoot).toHaveBeenCalledTimes(1);
    });

    it('should create Container directly when manifestPath is missing (JIT)', async () => {
      // Arrange
      mockGetRuntimeContext.mockReturnValue({});
      const worker = new HttpWorker();

      // Act
      await worker.init(1, createValidInitParams());

      // Assert — boot is called with a Container instance (from `new Container()`)
      const containerArg = mockBoot.mock.calls[0]?.[0];
      expect(containerArg).toBeInstanceOf(MockContainer);
      expect(mockBoot).toHaveBeenCalledTimes(1);
    });

    it('should create HttpAdapter instance with options', async () => {
      // Arrange
      mockGetRuntimeContext.mockReturnValue({});
      const worker = new HttpWorker();

      // Act
      await worker.init(1, createValidInitParams());

      // Assert — adapter is passed as third arg to httpServer.boot
      const adapterArg = mockBoot.mock.calls[0]?.[2] as Record<string, unknown>;
      expect(adapterArg).toBeDefined();
      expect(adapterArg.options).toEqual({ port: 3000 });
    });

    it('should wire middlewares from adapterConfig for each hook', async () => {
      // Arrange
      const onReceiveMiddleware = { token: 'OnReceiveMW', key: 'mw1' };
      const preHandleMiddleware = { token: 'PreHandleMW', key: 'mw2' };

      mockGetRuntimeContext.mockReturnValue({
        adapterConfig: {
          HttpAdapter: {
            middlewares: {
              [MiddlewareHook.OnReceive]: [onReceiveMiddleware],
              [MiddlewareHook.PreHandle]: [preHandleMiddleware],
            },
          },
        },
      });
      const worker = new HttpWorker();

      // Act
      await worker.init(1, createValidInitParams());

      // Assert
      expect(mockAddMiddlewares).toHaveBeenCalledTimes(2);
      expect(mockAddMiddlewares).toHaveBeenCalledWith(MiddlewareHook.OnReceive, [onReceiveMiddleware]);
      expect(mockAddMiddlewares).toHaveBeenCalledWith(MiddlewareHook.PreHandle, [preHandleMiddleware]);
    });

    it('should wire errorFilters from adapterConfig', async () => {
      // Arrange
      const errorFilter = { filterClass: 'GlobalFilter', catchType: 'Error' };

      mockGetRuntimeContext.mockReturnValue({
        adapterConfig: {
          HttpAdapter: {
            errorFilters: [errorFilter],
          },
        },
      });
      const worker = new HttpWorker();

      // Act
      await worker.init(1, createValidInitParams());

      // Assert
      expect(mockAddExceptionFilterEntries).toHaveBeenCalledTimes(1);
      expect(mockAddExceptionFilterEntries).toHaveBeenCalledWith([errorFilter]);
    });

    it('should wire guards from adapterConfig', async () => {
      // Arrange
      const guard = { guardClass: 'AuthGuard' };

      mockGetRuntimeContext.mockReturnValue({
        adapterConfig: {
          HttpAdapter: {
            guards: [guard],
          },
        },
      });
      const worker = new HttpWorker();

      // Act
      await worker.init(1, createValidInitParams());

      // Assert
      expect(mockAddGuards).toHaveBeenCalledTimes(1);
      expect(mockAddGuards).toHaveBeenCalledWith([guard]);
    });

    it('should use controllerInstances from RuntimeContext when available', async () => {
      // Arrange
      const prebuiltInstances = new Map<string, unknown>([['PrebuiltCtrl', { prebuilt: true }]]);

      mockGetRuntimeContext.mockReturnValue({
        controllerInstances: prebuiltInstances,
        handlerIndex: [createHandlerEntry()],
      });
      const worker = new HttpWorker();

      // Act
      await worker.init(1, createValidInitParams());

      // Assert — prebuilt instances should be passed through, not built from container
      const bootOptions = mockBoot.mock.calls[0]?.[1] as Record<string, unknown>;
      const instances = bootOptions.controllerInstances as Map<string, unknown>;
      expect(instances).toBe(prebuiltInstances);
    });

    it('should call httpServer.boot with adapter as third argument', async () => {
      // Arrange
      mockGetRuntimeContext.mockReturnValue({});
      const worker = new HttpWorker();

      // Act
      await worker.init(1, createValidInitParams());

      // Assert
      expect(mockBoot).toHaveBeenCalledTimes(1);
      const args = mockBoot.mock.calls[0];
      expect(args).toHaveLength(3);
      // First arg: container, second: boot options, third: adapter
      expect(args?.[0]).toBeDefined();
      expect(args?.[1]).toBeDefined();
      expect(args?.[2]).toBeDefined();
    });
  });
});
