import { describe, it, expect, mock, beforeEach } from 'bun:test';

import type { ZipbulContainer, Context } from '@zipbul/common';

import { Container } from '../../core/src/injector/container';
import type { RequestScopeContainer } from '../../core/src/injector/request-scope-container';

/**
 * [OVERFLOW Checkpoint]
 * - Target: HttpServer.fetch + real Container + RequestScopeContainer (end-to-end request scope lifecycle)
 * - Branch count: 15
 *   HttpServer.fetch():
 *     L102 `if (httpMethod === undefined)`, L126 `createRequestScope?.(requestId)`,
 *     L130 `await adapter.dispatchRequest`, L133 `catch (error)`,
 *     L141 `await requestContainer?.dispose?.()`, L142 `catch (disposeError)`
 *   Container.get():
 *     L74 `if (singletons.has)`, L80 `if (!registration)`, L86 `if (scope === 'request')`,
 *     L96 `if (scope === 'singleton')`
 *   RequestScopeContainer.get():
 *     L27 `if (scope === 'singleton')`, L31 `if (scope === 'transient')`,
 *     L35 `if (requestInstances.has)`, L39 else (create+cache)
 *   RequestScopeContainer.dispose():
 *     L81 `if (hasOnDestroy)`, L90 `requestInstances.clear()`
 * - Minimum per category: 50
 * - Categories:
 *   | Cat | Count | Sample (3+) |
 *   |-----|-------|-------------|
 *   | HP  | 55    | 1. fetch creates RequestScopeContainer and passes to dispatch (HttpServer.fetch L125-127), 2. handler resolves request-scoped provider from context container (RSC.get L39-43 via HttpContext.container), 3. dispose called after successful dispatch (HttpServer.fetch L141), 4. singleton shared across requests via RSC parent delegation (RSC.get L27 → Container.get L96), 5. each fetch generates unique contextId (HttpServer.fetch L125 crypto.randomUUID) |
 *   | NE  | 50    | 1. dispose called even when dispatch throws (HttpServer.fetch L139-144 finally block), 2. dispose error logged but fetch still returns response (HttpServer.fetch L142-144), 3. request-scoped provider onDestroy error doesn't crash fetch (RSC.dispose L84 catch) |
 *   | ED  | 50    | 1. fetch with no request-scoped providers registered (RSC.dispose L78 empty map), 2. concurrent fetches with zero delay between them (HttpServer.fetch L125-127 independent scopes), 3. handler that doesn't access container at all (HttpServer.fetch L130 dispatchRequest ignores container) |
 *   | CO  | 50    | 1. N concurrent fetches each create isolated request containers (HttpServer.fetch L126 per-call), 2. concurrent fetches with request-scoped provider resolving same token get different instances (RSC.get L39-43 per-container cache), 3. concurrent fetches with mixed scope providers maintain proper delegation (RSC.get L27 singleton + L39 request) |
 *   | ST  | 50    | 1. request-scoped instances destroyed after fetch completes (HttpServer.fetch L141 dispose), 2. singleton survives multiple fetch cycles (Container.singletons unaffected by RSC.dispose), 3. new fetch after previous creates fresh request scope (Container.createRequestScope L145-147) |
 *   | CR  | 50    | 1. parallel fetches each get unique requestId (HttpServer.fetch L125 crypto.randomUUID per call), 2. concurrent handler resolution from separate RSC instances (RSC.get L39-43 instance-local Map), 3. concurrent dispose calls on separate request scopes (RSC.dispose L77-91 operates on own map) |
 *   | ID  | 50    | 1. same request-scoped token resolved multiple times in single fetch yields same instance (RSC.get L35-36), 2. singleton resolved in every fetch returns same instance (Container.get L74-76), 3. contextId is stable within single fetch lifecycle (RSC.getContextId L68-69) |
 *   | OR  | 50    | 1. dispose runs after dispatch completes regardless of success (HttpServer.fetch L139 finally), 2. multiple request-scoped providers disposed in LIFO order (RSC.dispose L78 .reverse()), 3. dispatch → dispose ordering enforced by finally block (HttpServer.fetch L129-145) |
 * - Total scenarios: 405
 */

/**
 * [PRUNE Checkpoint]
 * - Scenarios before: 405
 * - Removed: 383
 * - Key removals (5+):
 *   1. HP-6~HP-55 repeat same container delegation with trivial variations; keeping HP-1~HP-5
 *   2. NE-4~NE-50 exercise same error recovery path; keeping NE-1,NE-2,NE-3
 *   3. ED-4~ED-50 boundary variations on empty/unused scopes; keeping ED-1,ED-2
 *   4. CO-4~CO-50 same concurrent isolation at different scale; keeping CO-1,CO-2,CO-3
 *   5. ST-4~ST-50 same lifecycle transitions; keeping ST-1,ST-2
 *   6. CR-3~CR-50 same parallel pattern; keeping CR-1,CR-2
 *   7. ID-3~ID-50 same idempotent resolution; keeping ID-1,ID-2
 *   8. OR-3~OR-50 same ordering guarantee; keeping OR-1,OR-2
 * - Final test count: 22
 * - Final test list:
 *   1.  [HP] should create a request-scoped container and pass it through dispatchRequest
 *   2.  [HP] should allow handler to resolve request-scoped providers from context container
 *   3.  [HP] should dispose request-scoped container after successful dispatch
 *   4.  [HP] should share singleton instances across multiple fetch calls
 *   5.  [HP] should generate a unique UUID contextId per fetch call
 *   6.  [NE] should dispose request-scoped container even when dispatch throws
 *   7.  [NE] should return response even when dispose throws
 *   8.  [NE] should dispose all request-scoped providers even when one onDestroy throws
 *   9.  [ED] should handle fetch with no request-scoped providers gracefully
 *   10. [ED] should handle fetch when container has no createRequestScope method
 *   11. [CO] should create isolated request scopes for concurrent fetches
 *   12. [CO] should resolve different request-scoped instances per concurrent fetch
 *   13. [CO] should maintain singleton identity while isolating request-scoped across concurrent fetches
 *   14. [ST] should destroy request-scoped instances after fetch and create fresh ones on next fetch
 *   15. [ST] should preserve singleton identity across multiple fetch-dispose cycles
 *   16. [CR] should assign unique contextIds to parallel fetch calls
 *   17. [CR] should safely dispose parallel request scopes without interference
 *   18. [ID] should return same request-scoped instance for repeated resolution within single fetch
 *   19. [ID] should return same singleton across all fetches
 *   20. [OR] should always run dispose after dispatch completes
 *   21. [OR] should dispose request-scoped providers in LIFO order within fetch lifecycle
 *   22. [OR] should complete dispatch before dispose runs
 */

// ── Logger mock ───────────────────────────────────────────────

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

    constructor() {
      return {
        debug: mockLoggerDebug,
        info: mockLoggerInfo,
        warn: mockLoggerWarn,
        error: mockLoggerError,
      };
    }
  },
}));

// utils/ip.ts no longer used — IP resolution moved to http-server.ts internals

const { HttpServer } = await import('../src/http-server');

type HttpServerInstance = InstanceType<typeof HttpServer>;

interface HttpAdapterLike {
  constructor: { name: string };
  decorators: { controller: { name: string }; handlers: { name: string }[] };
  setRouteHandler: ReturnType<typeof mock>;
  dispatchRequest: ReturnType<typeof mock>;
}

interface ServerInternals {
  adapter: HttpAdapterLike;
  container: ZipbulContainer;
  options: Record<string, unknown>;
  server: Record<string, unknown>;
  allowedMethods: ReadonlySet<string>;
}

// ── Fixtures ──────────────────────────────────────────────────

interface DisposalTracker {
  readonly disposed: string[];
}

function createTrackedFactory(label: string, tracker: DisposalTracker) {
  return (_container: ZipbulContainer) => ({
    label,
    onDestroy() {
      tracker.disposed.push(label);
    },
  });
}

function createMockAdapter(): HttpAdapterLike {
  return {
    constructor: { name: 'MockAdapter' },
    decorators: {
      controller: { name: 'Controller' },
      handlers: [],
    },
    setRouteHandler: mock(() => {}),
    dispatchRequest: mock(async () => {}),
  };
}

function wireServer(
  server: HttpServerInstance,
  container: ZipbulContainer,
  adapter: HttpAdapterLike,
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

const mockBunServer = { requestIP: () => ({ address: '127.0.0.1', family: 'IPv4', port: 0 }) } as unknown as import('bun').Server<unknown>;

// ── Tests ──────────────────────────────────────────────────────

describe('Request scope HTTP lifecycle', () => {
  let server: HttpServerInstance;

  beforeEach(() => {
    server = new HttpServer();
    mockLoggerDebug.mockClear();
    mockLoggerInfo.mockClear();
    mockLoggerWarn.mockClear();
    mockLoggerError.mockClear();
  });

  // ── HP: Happy Path ──────────────────────────────────────────

  it('should create a request-scoped container and pass it through dispatchRequest', async () => {
    // Arrange
    const container = new Container();
    const adapter = createMockAdapter();
    let receivedContainer: ZipbulContainer | undefined;
    adapter.dispatchRequest.mockImplementation(async (context: Context) => {
      receivedContainer = (context as unknown as { container: ZipbulContainer }).container;
    });
    wireServer(server, container, adapter);

    // Act
    await server.fetch(createGetRequest(), mockBunServer);

    // Assert
    expect(receivedContainer).toBeDefined();
    expect(receivedContainer).not.toBe(container);
  });

  it('should allow handler to resolve request-scoped providers from context container', async () => {
    // Arrange
    const container = new Container();
    let instanceCount = 0;
    container.set('reqService', (_c: ZipbulContainer) => {
      instanceCount += 1;
      return { serviceId: instanceCount };
    }, { scope: 'request' });

    const adapter = createMockAdapter();
    let resolvedService: { serviceId: number } | undefined;
    adapter.dispatchRequest.mockImplementation(async (context: Context) => {
      const reqContainer = (context as unknown as { container: ZipbulContainer }).container;
      resolvedService = reqContainer.get('reqService') as { serviceId: number };
    });
    wireServer(server, container, adapter);

    // Act
    await server.fetch(createGetRequest(), mockBunServer);

    // Assert
    expect(resolvedService).toBeDefined();
    expect(resolvedService!.serviceId).toBe(1);
  });

  it('should dispose request-scoped container after successful dispatch', async () => {
    // Arrange
    const container = new Container();
    const tracker: DisposalTracker = { disposed: [] };
    container.set('reqService', createTrackedFactory('service', tracker), { scope: 'request' });

    const adapter = createMockAdapter();
    adapter.dispatchRequest.mockImplementation(async (context: Context) => {
      const reqContainer = (context as unknown as { container: ZipbulContainer }).container;
      reqContainer.get('reqService');
    });
    wireServer(server, container, adapter);

    // Act
    await server.fetch(createGetRequest(), mockBunServer);

    // Assert
    expect(tracker.disposed).toEqual(['service']);
  });

  it('should share singleton instances across multiple fetch calls', async () => {
    // Arrange
    const container = new Container();
    let singletonCount = 0;
    container.set('singleton', (_c: ZipbulContainer) => {
      singletonCount += 1;
      return { id: singletonCount };
    }, { scope: 'singleton' });

    const adapter = createMockAdapter();
    const resolved: unknown[] = [];
    adapter.dispatchRequest.mockImplementation(async (context: Context) => {
      const reqContainer = (context as unknown as { container: ZipbulContainer }).container;
      resolved.push(reqContainer.get('singleton'));
    });
    wireServer(server, container, adapter);

    // Act
    await server.fetch(createGetRequest('/a'), mockBunServer);
    await server.fetch(createGetRequest('/b'), mockBunServer);
    await server.fetch(createGetRequest('/c'), mockBunServer);

    // Assert
    expect(resolved).toHaveLength(3);
    expect(resolved[0]).toBe(resolved[1]);
    expect(resolved[1]).toBe(resolved[2]);
    expect(singletonCount).toBe(1);
  });

  it('should generate a unique UUID contextId per fetch call', async () => {
    // Arrange
    const container = new Container();
    const adapter = createMockAdapter();
    const contextIds: string[] = [];
    adapter.dispatchRequest.mockImplementation(async (context: Context) => {
      const reqContainer = (context as unknown as { container: ZipbulContainer }).container;
      const contextId = (reqContainer as RequestScopeContainer).getContextId();
      contextIds.push(contextId);
    });
    wireServer(server, container, adapter);
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

    // Act
    await server.fetch(createGetRequest('/a'), mockBunServer);
    await server.fetch(createGetRequest('/b'), mockBunServer);

    // Assert
    expect(contextIds).toHaveLength(2);
    expect(contextIds[0]).toMatch(uuidRegex);
    expect(contextIds[1]).toMatch(uuidRegex);
    expect(contextIds[0]).not.toBe(contextIds[1]);
  });

  // ── NE: Negative / Error ──────────────────────────────────

  it('should dispose request-scoped container even when dispatch throws', async () => {
    // Arrange
    const container = new Container();
    const tracker: DisposalTracker = { disposed: [] };
    container.set('reqService', createTrackedFactory('service', tracker), { scope: 'request' });

    const adapter = createMockAdapter();
    adapter.dispatchRequest.mockImplementation(async (context: Context) => {
      const reqContainer = (context as unknown as { container: ZipbulContainer }).container;
      reqContainer.get('reqService');
      throw new Error('handler crash');
    });
    wireServer(server, container, adapter);

    // Act
    await server.fetch(createGetRequest(), mockBunServer);

    // Assert
    expect(tracker.disposed).toEqual(['service']);
  });

  it('should return response even when dispose throws', async () => {
    // Arrange
    const container = new Container();
    container.set('badDispose', (_c: ZipbulContainer) => ({
      onDestroy() {
        throw new Error('dispose failure');
      },
    }), { scope: 'request' });

    const adapter = createMockAdapter();
    adapter.dispatchRequest.mockImplementation(async (context: Context) => {
      const reqContainer = (context as unknown as { container: ZipbulContainer }).container;
      reqContainer.get('badDispose');
    });
    wireServer(server, container, adapter);

    // Act
    const response = await server.fetch(createGetRequest(), mockBunServer);

    // Assert
    expect(response).toBeInstanceOf(Response);
    expect(response.status).not.toBe(500);
  });

  it('should dispose all request-scoped providers even when one onDestroy throws', async () => {
    // Arrange
    const container = new Container();
    const tracker: DisposalTracker = { disposed: [] };
    container.set('good1', createTrackedFactory('good1', tracker), { scope: 'request' });
    container.set('bad', (_c: ZipbulContainer) => ({
      onDestroy() { throw new Error('boom'); },
    }), { scope: 'request' });
    container.set('good2', createTrackedFactory('good2', tracker), { scope: 'request' });

    const adapter = createMockAdapter();
    adapter.dispatchRequest.mockImplementation(async (context: Context) => {
      const reqContainer = (context as unknown as { container: ZipbulContainer }).container;
      reqContainer.get('good1');
      reqContainer.get('bad');
      reqContainer.get('good2');
    });
    wireServer(server, container, adapter);

    // Act
    await server.fetch(createGetRequest(), mockBunServer);

    // Assert
    expect(tracker.disposed).toContain('good1');
    expect(tracker.disposed).toContain('good2');
  });

  // ── ED: Edge ──────────────────────────────────────────────

  it('should handle fetch with no request-scoped providers gracefully', async () => {
    // Arrange
    const container = new Container();
    container.set('singleton', () => ({ value: 42 }), { scope: 'singleton' });
    const adapter = createMockAdapter();
    wireServer(server, container, adapter);

    // Act
    const response = await server.fetch(createGetRequest(), mockBunServer);

    // Assert
    expect(response).toBeInstanceOf(Response);
  });

  it('should handle fetch when container has no createRequestScope method', async () => {
    // Arrange
    const bareContainer: ZipbulContainer = {
      get: mock(() => undefined),
      set: mock(() => {}),
      has: mock(() => false),
      getInstances: mock(function* () {}),
      keys: mock(function* () {}),
    };
    const adapter = createMockAdapter();
    wireServer(server, bareContainer, adapter);

    // Act
    const response = await server.fetch(createGetRequest(), mockBunServer);

    // Assert
    expect(response).toBeInstanceOf(Response);
    expect(response.status).not.toBe(500);
  });

  // ── CO: Concurrency ──────────────────────────────────────

  it('should create isolated request scopes for concurrent fetches', async () => {
    // Arrange
    const container = new Container();
    let count = 0;
    container.set('reqService', (_c: ZipbulContainer) => {
      count += 1;
      return { id: count };
    }, { scope: 'request' });

    const adapter = createMockAdapter();
    const resolvedIds: number[] = [];
    adapter.dispatchRequest.mockImplementation(async (context: Context) => {
      const reqContainer = (context as unknown as { container: ZipbulContainer }).container;
      const service = reqContainer.get('reqService') as { id: number };
      resolvedIds.push(service.id);
    });
    wireServer(server, container, adapter);

    // Act
    await Promise.all(
      Array.from({ length: 10 }, (_, index) => server.fetch(createGetRequest(`/${index}`), mockBunServer)),
    );

    // Assert
    expect(resolvedIds).toHaveLength(10);
    const uniqueIds = new Set(resolvedIds);
    expect(uniqueIds.size).toBe(10);
  });

  it('should resolve different request-scoped instances per concurrent fetch', async () => {
    // Arrange
    const container = new Container();
    container.set('reqService', (_c: ZipbulContainer) => {
      return { created: Date.now(), random: Math.random() };
    }, { scope: 'request' });

    const adapter = createMockAdapter();
    const instances: unknown[] = [];
    adapter.dispatchRequest.mockImplementation(async (context: Context) => {
      const reqContainer = (context as unknown as { container: ZipbulContainer }).container;
      instances.push(reqContainer.get('reqService'));
    });
    wireServer(server, container, adapter);

    // Act
    await Promise.all([
      server.fetch(createGetRequest('/a'), mockBunServer),
      server.fetch(createGetRequest('/b'), mockBunServer),
      server.fetch(createGetRequest('/c'), mockBunServer),
    ]);

    // Assert
    expect(instances).toHaveLength(3);
    expect(instances[0]).not.toBe(instances[1]);
    expect(instances[1]).not.toBe(instances[2]);
  });

  it('should maintain singleton identity while isolating request-scoped across concurrent fetches', async () => {
    // Arrange
    const container = new Container();
    let singletonCount = 0;
    let requestCount = 0;
    container.set('singleton', (_c: ZipbulContainer) => {
      singletonCount += 1;
      return { singletonId: singletonCount };
    }, { scope: 'singleton' });
    container.set('reqProvider', (_c: ZipbulContainer) => {
      requestCount += 1;
      return { requestId: requestCount };
    }, { scope: 'request' });

    const adapter = createMockAdapter();
    const results: Array<{ singleton: unknown; request: unknown }> = [];
    adapter.dispatchRequest.mockImplementation(async (context: Context) => {
      const reqContainer = (context as unknown as { container: ZipbulContainer }).container;
      results.push({
        singleton: reqContainer.get('singleton'),
        request: reqContainer.get('reqProvider'),
      });
    });
    wireServer(server, container, adapter);

    // Act
    await Promise.all([
      server.fetch(createGetRequest('/a'), mockBunServer),
      server.fetch(createGetRequest('/b'), mockBunServer),
      server.fetch(createGetRequest('/c'), mockBunServer),
    ]);

    // Assert
    expect(results).toHaveLength(3);
    // Singleton is same across all
    expect(results[0].singleton).toBe(results[1].singleton);
    expect(results[1].singleton).toBe(results[2].singleton);
    expect(singletonCount).toBe(1);
    // Request-scoped are all different
    expect(results[0].request).not.toBe(results[1].request);
    expect(results[1].request).not.toBe(results[2].request);
    expect(requestCount).toBe(3);
  });

  // ── ST: State Transition ──────────────────────────────────

  it('should destroy request-scoped instances after fetch and create fresh ones on next fetch', async () => {
    // Arrange
    const container = new Container();
    const tracker: DisposalTracker = { disposed: [] };
    let createCount = 0;
    container.set('reqService', (_c: ZipbulContainer) => {
      createCount += 1;
      const label = `instance-${createCount}`;
      return {
        label,
        onDestroy() {
          tracker.disposed.push(label);
        },
      };
    }, { scope: 'request' });

    const adapter = createMockAdapter();
    adapter.dispatchRequest.mockImplementation(async (context: Context) => {
      const reqContainer = (context as unknown as { container: ZipbulContainer }).container;
      reqContainer.get('reqService');
    });
    wireServer(server, container, adapter);

    // Act
    await server.fetch(createGetRequest('/first'), mockBunServer);
    await server.fetch(createGetRequest('/second'), mockBunServer);

    // Assert
    expect(createCount).toBe(2);
    expect(tracker.disposed).toEqual(['instance-1', 'instance-2']);
  });

  it('should preserve singleton identity across multiple fetch-dispose cycles', async () => {
    // Arrange
    const container = new Container();
    let singletonCount = 0;
    container.set('singleton', (_c: ZipbulContainer) => {
      singletonCount += 1;
      return { id: singletonCount };
    }, { scope: 'singleton' });

    const adapter = createMockAdapter();
    const singletonRefs: unknown[] = [];
    adapter.dispatchRequest.mockImplementation(async (context: Context) => {
      const reqContainer = (context as unknown as { container: ZipbulContainer }).container;
      singletonRefs.push(reqContainer.get('singleton'));
    });
    wireServer(server, container, adapter);

    // Act — 5 sequential fetch-dispose cycles
    for (let cycle = 0; cycle < 5; cycle++) {
      await server.fetch(createGetRequest(`/cycle-${cycle}`), mockBunServer);
    }

    // Assert
    expect(singletonRefs).toHaveLength(5);
    const allSame = singletonRefs.every(ref => ref === singletonRefs[0]);
    expect(allSame).toBe(true);
    expect(singletonCount).toBe(1);
  });

  // ── CR: Concurrency / Race ──────────────────────────────────

  it('should assign unique contextIds to parallel fetch calls', async () => {
    // Arrange
    const container = new Container();
    const adapter = createMockAdapter();
    const contextIds: string[] = [];
    adapter.dispatchRequest.mockImplementation(async (context: Context) => {
      const reqContainer = (context as unknown as { container: ZipbulContainer }).container;
      const contextId = (reqContainer as RequestScopeContainer).getContextId();
      contextIds.push(contextId);
    });
    wireServer(server, container, adapter);

    // Act
    await Promise.all(
      Array.from({ length: 20 }, (_, index) => server.fetch(createGetRequest(`/${index}`), mockBunServer)),
    );

    // Assert
    const uniqueIds = new Set(contextIds);
    expect(uniqueIds.size).toBe(20);
  });

  it('should safely dispose parallel request scopes without interference', async () => {
    // Arrange
    const container = new Container();
    const tracker: DisposalTracker = { disposed: [] };
    container.set('reqProvider', (c: ZipbulContainer) => {
      const contextId = (c as RequestScopeContainer).getContextId();
      return {
        contextId,
        onDestroy() {
          tracker.disposed.push(contextId);
        },
      };
    }, { scope: 'request' });

    const adapter = createMockAdapter();
    adapter.dispatchRequest.mockImplementation(async (context: Context) => {
      const reqContainer = (context as unknown as { container: ZipbulContainer }).container;
      reqContainer.get('reqProvider');
    });
    wireServer(server, container, adapter);

    // Act
    await Promise.all(
      Array.from({ length: 15 }, (_, index) => server.fetch(createGetRequest(`/${index}`), mockBunServer)),
    );

    // Assert
    expect(tracker.disposed).toHaveLength(15);
    const uniqueDisposed = new Set(tracker.disposed);
    expect(uniqueDisposed.size).toBe(15);
  });

  // ── ID: Idempotency ──────────────────────────────────────

  it('should return same request-scoped instance for repeated resolution within single fetch', async () => {
    // Arrange
    const container = new Container();
    let factoryCallCount = 0;
    container.set('reqService', (_c: ZipbulContainer) => {
      factoryCallCount += 1;
      return { id: factoryCallCount };
    }, { scope: 'request' });

    const adapter = createMockAdapter();
    let firstGet: unknown;
    let secondGet: unknown;
    let thirdGet: unknown;
    adapter.dispatchRequest.mockImplementation(async (context: Context) => {
      const reqContainer = (context as unknown as { container: ZipbulContainer }).container;
      firstGet = reqContainer.get('reqService');
      secondGet = reqContainer.get('reqService');
      thirdGet = reqContainer.get('reqService');
    });
    wireServer(server, container, adapter);

    // Act
    await server.fetch(createGetRequest(), mockBunServer);

    // Assert
    expect(firstGet).toBe(secondGet);
    expect(secondGet).toBe(thirdGet);
    expect(factoryCallCount).toBe(1);
  });

  it('should return same singleton across all fetches', async () => {
    // Arrange
    const container = new Container();
    let factoryCallCount = 0;
    container.set('singleton', (_c: ZipbulContainer) => {
      factoryCallCount += 1;
      return { id: factoryCallCount };
    }, { scope: 'singleton' });

    const adapter = createMockAdapter();
    const instances: unknown[] = [];
    adapter.dispatchRequest.mockImplementation(async (context: Context) => {
      const reqContainer = (context as unknown as { container: ZipbulContainer }).container;
      instances.push(reqContainer.get('singleton'));
    });
    wireServer(server, container, adapter);

    // Act
    for (let fetchIndex = 0; fetchIndex < 10; fetchIndex++) {
      await server.fetch(createGetRequest(`/fetch-${fetchIndex}`), mockBunServer);
    }

    // Assert
    expect(instances).toHaveLength(10);
    const allSame = instances.every(instance => instance === instances[0]);
    expect(allSame).toBe(true);
    expect(factoryCallCount).toBe(1);
  });

  // ── OR: Ordering ──────────────────────────────────────────

  it('should always run dispose after dispatch completes', async () => {
    // Arrange
    const container = new Container();
    const events: string[] = [];
    container.set('reqService', (_c: ZipbulContainer) => ({
      onDestroy() {
        events.push('disposed');
      },
    }), { scope: 'request' });

    const adapter = createMockAdapter();
    adapter.dispatchRequest.mockImplementation(async (context: Context) => {
      const reqContainer = (context as unknown as { container: ZipbulContainer }).container;
      reqContainer.get('reqService');
      events.push('dispatched');
    });
    wireServer(server, container, adapter);

    // Act
    await server.fetch(createGetRequest(), mockBunServer);

    // Assert
    expect(events).toEqual(['dispatched', 'disposed']);
  });

  it('should dispose request-scoped providers in LIFO order within fetch lifecycle', async () => {
    // Arrange
    const container = new Container();
    const tracker: DisposalTracker = { disposed: [] };
    container.set('first', createTrackedFactory('first', tracker), { scope: 'request' });
    container.set('second', createTrackedFactory('second', tracker), { scope: 'request' });
    container.set('third', createTrackedFactory('third', tracker), { scope: 'request' });

    const adapter = createMockAdapter();
    adapter.dispatchRequest.mockImplementation(async (context: Context) => {
      const reqContainer = (context as unknown as { container: ZipbulContainer }).container;
      reqContainer.get('first');
      reqContainer.get('second');
      reqContainer.get('third');
    });
    wireServer(server, container, adapter);

    // Act
    await server.fetch(createGetRequest(), mockBunServer);

    // Assert
    expect(tracker.disposed).toEqual(['third', 'second', 'first']);
  });

  it('should complete dispatch before dispose runs', async () => {
    // Arrange
    const container = new Container();
    const timeline: Array<{ event: string; timestamp: number }> = [];
    container.set('reqService', (_c: ZipbulContainer) => ({
      async onDestroy() {
        timeline.push({ event: 'dispose-start', timestamp: performance.now() });
        await new Promise(resolve => setTimeout(resolve, 1));
        timeline.push({ event: 'dispose-end', timestamp: performance.now() });
      },
    }), { scope: 'request' });

    const adapter = createMockAdapter();
    adapter.dispatchRequest.mockImplementation(async (context: Context) => {
      const reqContainer = (context as unknown as { container: ZipbulContainer }).container;
      reqContainer.get('reqService');
      timeline.push({ event: 'dispatch-start', timestamp: performance.now() });
      await new Promise(resolve => setTimeout(resolve, 1));
      timeline.push({ event: 'dispatch-end', timestamp: performance.now() });
    });
    wireServer(server, container, adapter);

    // Act
    await server.fetch(createGetRequest(), mockBunServer);

    // Assert
    const eventOrder = timeline.map(entry => entry.event);
    expect(eventOrder).toEqual(['dispatch-start', 'dispatch-end', 'dispose-start', 'dispose-end']);
  });
});
