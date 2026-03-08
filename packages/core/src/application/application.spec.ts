import { describe, it, expect, mock, beforeEach, type Mock } from 'bun:test';
import type { Adapter, AdapterClass, Context, ZipbulContainer, ProviderToken } from '@zipbul/common';
import { MiddlewareHook, defineMiddleware } from '@zipbul/common';

let mockAdapterConfig: Record<string, unknown> | undefined;

mock.module('@zipbul/baker', () => ({
  seal: () => {},
}));

mock.module('../runtime/runtime-context', () => ({
  getRuntimeContext: () => ({ adapterConfig: mockAdapterConfig }),
}));

const { Application } = await import('./application');

/**
 * Creates a unique adapter class with spied start/stop.
 * Each call produces a distinct class so class-reference identity works.
 */
function createMockAdapterClass(): {
  AdapterClass: AdapterClass;
  instance: Adapter & {
    start: Mock<(ctx: Context) => Promise<void>>;
    stop: Mock<() => Promise<void>>;
  };
} {
  const startFn = mock(() => Promise.resolve());
  const stopFn = mock(() => Promise.resolve());

  class MockAdapter {
    start = startFn;
    stop = stopFn;
  }

  const instance = new MockAdapter() as Adapter & {
    start: Mock<(ctx: Context) => Promise<void>>;
    stop: Mock<() => Promise<void>>;
  };

  return {
    AdapterClass: MockAdapter as unknown as AdapterClass,
    instance,
  };
}

/**
 * Simple mock adapter for tests that don't need class identity.
 */
function createMockAdapter(): Adapter & {
  start: Mock<(ctx: Context) => Promise<void>>;
  stop: Mock<() => Promise<void>>;
} {
  return createMockAdapterClass().instance;
}

describe('Application', () => {
  let app: Application;

  beforeEach(() => {
    mockAdapterConfig = undefined;
    app = new Application();
  });

  // ── addAdapter ───────────────────────────────────────────────

  describe('addAdapter', () => {
    it('should register a single adapter without config', () => {
      // Arrange
      const adapter = createMockAdapter();

      // Act & Assert — no throw
      expect(() => app.addAdapter(adapter)).not.toThrow();
    });

    it('should register a single adapter with name', () => {
      // Arrange
      const adapter = createMockAdapter();

      // Act & Assert — no throw
      expect(() => app.addAdapter(adapter, { name: 'http' })).not.toThrow();
    });

    it('should throw when same class registered twice without name', () => {
      // Arrange
      const { AdapterClass, instance: instanceA } = createMockAdapterClass();
      const instanceB = new AdapterClass() as unknown as Adapter;

      app.addAdapter(instanceA);

      // Act & Assert
      expect(() => app.addAdapter(instanceB)).toThrow(/registered multiple times/i);
    });

    it('should allow same class registered twice with different names', () => {
      // Arrange
      const { AdapterClass, instance: instanceA } = createMockAdapterClass();
      const instanceB = new AdapterClass() as unknown as Adapter;

      // Act & Assert
      app.addAdapter(instanceA, { name: 'api' });
      expect(() => app.addAdapter(instanceB, { name: 'admin' })).not.toThrow();
    });

    it('should throw when same class registered twice with duplicate name', () => {
      // Arrange
      const { AdapterClass, instance: instanceA } = createMockAdapterClass();
      const instanceB = new AdapterClass() as unknown as Adapter;

      app.addAdapter(instanceA, { name: 'api' });

      // Act & Assert
      expect(() => app.addAdapter(instanceB, { name: 'api' })).toThrow(/already registered/i);
    });

    it('should throw when second registration of same class omits name while first has name', () => {
      // Arrange
      const { AdapterClass, instance: instanceA } = createMockAdapterClass();
      const instanceB = new AdapterClass() as unknown as Adapter;

      app.addAdapter(instanceA, { name: 'api' });

      // Act & Assert — unnamed second registration is ambiguous
      expect(() => app.addAdapter(instanceB)).toThrow(/registered multiple times/i);
    });

    it('should register multiple adapters of different classes without names', () => {
      // Arrange
      const adapterA = createMockAdapter();
      const adapterB = createMockAdapter();

      // Act & Assert
      app.addAdapter(adapterA);
      expect(() => app.addAdapter(adapterB)).not.toThrow();
    });

    it('should not corrupt state when duplicate add throws — next add succeeds', () => {
      // Arrange
      const { AdapterClass, instance: instanceA } = createMockAdapterClass();
      const instanceB = new AdapterClass() as unknown as Adapter;

      app.addAdapter(instanceA);

      // Act — duplicate throws
      expect(() => app.addAdapter(instanceB)).toThrow();

      // Assert — different class still works
      expect(() => app.addAdapter(createMockAdapter())).not.toThrow();
    });

    it('should throw when called after start', async () => {
      // Arrange
      app.addAdapter(createMockAdapter());
      await app.start();

      // Act & Assert
      expect(() => app.addAdapter(createMockAdapter())).toThrow(
        /started|running|cannot add/i,
      );
    });
  });

  // ── getContainer ─────────────────────────────────────────────

  describe('getContainer', () => {
    it('should return a ZipbulContainer with has, get, keys methods', () => {
      // Act
      const container = app.getContainer();

      // Assert
      expect(typeof container.has).toBe('function');
      expect(typeof container.get).toBe('function');
      expect(typeof container.keys).toBe('function');
    });

    it('should return the same container reference on every call', () => {
      // Act
      const first = app.getContainer();
      const second = app.getContainer();
      const third = app.getContainer();

      // Assert
      expect(first).toBe(second);
      expect(second).toBe(third);
    });
  });

  // ── get ──────────────────────────────────────────────────────

  describe('get', () => {
    it('should delegate to container.get with the given token when visibleTo is all', () => {
      // Arrange
      const token: ProviderToken = 'MY_TOKEN';
      const container = app.getContainer();
      const expectedValue = { foo: 'bar' };
      container.set(token, () => expectedValue, { scope: 'singleton', visibleTo: 'all' });

      // Act
      const result = app.get(token);

      // Assert
      expect(result).toBe(expectedValue);
    });

    it('should propagate container error when token is not found', () => {
      // Act & Assert
      expect(() => app.get('NONEXISTENT_TOKEN')).toThrow();
    });

    it('should throw when accessing non-singleton provider via app.get', () => {
      // Arrange
      const container = app.getContainer();
      container.set('TRANSIENT_TOKEN', () => 'value', { scope: 'transient', visibleTo: 'all' });

      // Act & Assert
      expect(() => app.get('TRANSIENT_TOKEN')).toThrow(/singleton/i);
    });

    it('should throw when accessing module-scoped provider via app.get', () => {
      // Arrange
      const container = app.getContainer();
      container.set('MODULE_TOKEN', () => 'value', { scope: 'singleton', visibleTo: 'module' });

      // Act & Assert
      expect(() => app.get('MODULE_TOKEN')).toThrow(/visibleTo/i);
    });
  });

  // ── start ────────────────────────────────────────────────────

  describe('start', () => {
    it('should resolve immediately when no adapters are registered', async () => {
      // Act & Assert — no throw, resolves
      await expect(app.start()).resolves.toBeUndefined();
    });

    it('should call adapter.start with context for single adapter', async () => {
      // Arrange
      const adapter = createMockAdapter();
      app.addAdapter(adapter);

      // Act
      await app.start();

      // Assert
      expect(adapter.start).toHaveBeenCalledTimes(1);
      const ctx = adapter.start.mock.calls[0]![0] as Context;
      expect(typeof ctx.getType).toBe('function');
    });

    it('should call adapter.start in registration order for multiple adapters', async () => {
      // Arrange
      const callOrder: string[] = [];
      const adapterA = createMockAdapter();
      adapterA.start.mockImplementation(async () => { callOrder.push('A'); });
      const adapterB = createMockAdapter();
      adapterB.start.mockImplementation(async () => { callOrder.push('B'); });
      const adapterC = createMockAdapter();
      adapterC.start.mockImplementation(async () => { callOrder.push('C'); });

      app.addAdapter(adapterA);
      app.addAdapter(adapterB);
      app.addAdapter(adapterC);

      // Act
      await app.start();

      // Assert
      expect(callOrder).toEqual(['A', 'B', 'C']);
    });

    it('should propagate error when adapter.start rejects', async () => {
      // Arrange
      const adapter = createMockAdapter();
      adapter.start.mockImplementation(async () => { throw new Error('start failed'); });
      app.addAdapter(adapter);

      // Act & Assert
      await expect(app.start()).rejects.toThrow('start failed');
    });

    it('should have already called earlier adapters start before a later adapter rejects', async () => {
      // Arrange
      const adapterA = createMockAdapter();
      const adapterB = createMockAdapter();
      adapterB.start.mockImplementation(async () => { throw new Error('B failed'); });

      app.addAdapter(adapterA);
      app.addAdapter(adapterB);

      // Act
      try { await app.start(); } catch { /* expected */ }

      // Assert — A was started before B threw
      expect(adapterA.start).toHaveBeenCalledTimes(1);
      expect(adapterB.start).toHaveBeenCalledTimes(1);
    });

    it('should throw when start is called twice', async () => {
      // Arrange
      app.addAdapter(createMockAdapter());
      await app.start();

      // Act & Assert
      await expect(app.start()).rejects.toThrow(/already started|double start/i);
    });
  });

  // ── stop ─────────────────────────────────────────────────────

  describe('stop', () => {
    it('should resolve immediately when no adapters are registered', async () => {
      // Arrange — start first (no adapters), then stop
      await app.start();

      // Act & Assert
      await expect(app.stop()).resolves.toBeUndefined();
    });

    it('should call adapter.stop for single adapter', async () => {
      // Arrange
      const adapter = createMockAdapter();
      app.addAdapter(adapter);
      await app.start();

      // Act
      await app.stop();

      // Assert
      expect(adapter.stop).toHaveBeenCalledTimes(1);
    });

    it('should call adapter.stop in reverse registration order for multiple adapters', async () => {
      // Arrange
      const callOrder: string[] = [];
      const adapterA = createMockAdapter();
      adapterA.stop.mockImplementation(async () => { callOrder.push('A'); });
      const adapterB = createMockAdapter();
      adapterB.stop.mockImplementation(async () => { callOrder.push('B'); });
      const adapterC = createMockAdapter();
      adapterC.stop.mockImplementation(async () => { callOrder.push('C'); });

      app.addAdapter(adapterA);
      app.addAdapter(adapterB);
      app.addAdapter(adapterC);
      await app.start();

      // Act
      await app.stop();

      // Assert — reverse order: C, B, A
      expect(callOrder).toEqual(['C', 'B', 'A']);
    });

    it('should propagate error when adapter.stop rejects', async () => {
      // Arrange
      const adapter = createMockAdapter();
      adapter.stop.mockImplementation(async () => { throw new Error('stop failed'); });
      app.addAdapter(adapter);
      await app.start();

      // Act & Assert
      await expect(app.stop()).rejects.toThrow('stop failed');
    });

    it('should have already called earlier stop (reverse) before a later one rejects', async () => {
      // Arrange — A registered first, B second → stop order: B, A
      const adapterA = createMockAdapter();
      adapterA.stop.mockImplementation(async () => { throw new Error('A stop failed'); });
      const adapterB = createMockAdapter();

      app.addAdapter(adapterA);
      app.addAdapter(adapterB);
      await app.start();

      // Act — stop reverses: B first (succeeds), then A (throws)
      try { await app.stop(); } catch { /* expected */ }

      // Assert — B was stopped before A threw
      expect(adapterB.stop).toHaveBeenCalledTimes(1);
      expect(adapterA.stop).toHaveBeenCalledTimes(1);
    });

    it('should throw when stop is called before start', async () => {
      // Act & Assert
      await expect(app.stop()).rejects.toThrow(/not.+started|not running/i);
    });

    it('should throw when stop is called twice', async () => {
      // Arrange
      app.addAdapter(createMockAdapter());
      await app.start();
      await app.stop();

      // Act & Assert
      await expect(app.stop()).rejects.toThrow(/already stopped|double stop/i);
    });
  });

  // ── Lifecycle ────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('should complete full lifecycle: addAdapter → start → stop', async () => {
      // Arrange
      const adapter = createMockAdapter();
      app.addAdapter(adapter);

      // Act
      await app.start();
      await app.stop();

      // Assert
      expect(adapter.start).toHaveBeenCalledTimes(1);
      expect(adapter.stop).toHaveBeenCalledTimes(1);
    });

    it('should return same container reference before and after start/stop', async () => {
      // Arrange
      const before = app.getContainer();
      app.addAdapter(createMockAdapter());

      // Act
      const afterAdd = app.getContainer();
      await app.start();
      const afterStart = app.getContainer();
      await app.stop();
      const afterStop = app.getContainer();

      // Assert
      expect(before).toBe(afterAdd);
      expect(afterAdd).toBe(afterStart);
      expect(afterStart).toBe(afterStop);
    });
  });

  // ── dependsOn — topological sort ────────────────────────────

  describe('dependsOn - topological sort', () => {
    it('should start adapters in dependency order when A→B chain exists', async () => {
      // Arrange
      const callOrder: string[] = [];
      const classA = createMockAdapterClass();
      classA.instance.start.mockImplementation(async () => { callOrder.push('A'); });
      const classB = createMockAdapterClass();
      classB.instance.start.mockImplementation(async () => { callOrder.push('B'); });

      app.addAdapter(classA.instance);
      app.addAdapter(classB.instance, { dependsOn: [classA.AdapterClass] });

      // Act
      await app.start();

      // Assert
      expect(callOrder).toEqual(['A', 'B']);
    });

    it('should start adapters in correct order for linear chain A→B→C', async () => {
      // Arrange
      const callOrder: string[] = [];
      const classA = createMockAdapterClass();
      classA.instance.start.mockImplementation(async () => { callOrder.push('A'); });
      const classB = createMockAdapterClass();
      classB.instance.start.mockImplementation(async () => { callOrder.push('B'); });
      const classC = createMockAdapterClass();
      classC.instance.start.mockImplementation(async () => { callOrder.push('C'); });

      app.addAdapter(classA.instance);
      app.addAdapter(classB.instance, { dependsOn: [classA.AdapterClass] });
      app.addAdapter(classC.instance, { dependsOn: [classB.AdapterClass] });

      // Act
      await app.start();

      // Assert
      expect(callOrder).toEqual(['A', 'B', 'C']);
    });

    it('should start adapters in correct order for diamond DAG', async () => {
      // Arrange — A → {B, C} → D
      const callOrder: string[] = [];
      const classA = createMockAdapterClass();
      classA.instance.start.mockImplementation(async () => { callOrder.push('A'); });
      const classB = createMockAdapterClass();
      classB.instance.start.mockImplementation(async () => { callOrder.push('B'); });
      const classC = createMockAdapterClass();
      classC.instance.start.mockImplementation(async () => { callOrder.push('C'); });
      const classD = createMockAdapterClass();
      classD.instance.start.mockImplementation(async () => { callOrder.push('D'); });

      app.addAdapter(classA.instance);
      app.addAdapter(classB.instance, { dependsOn: [classA.AdapterClass] });
      app.addAdapter(classC.instance, { dependsOn: [classA.AdapterClass] });
      app.addAdapter(classD.instance, { dependsOn: [classB.AdapterClass, classC.AdapterClass] });

      // Act
      await app.start();

      // Assert — A first, D last, B and C in between (registration order)
      expect(callOrder[0]).toBe('A');
      expect(callOrder[3]).toBe('D');
      expect(callOrder.indexOf('B')).toBeLessThan(callOrder.indexOf('D'));
      expect(callOrder.indexOf('C')).toBeLessThan(callOrder.indexOf('D'));
    });

    it('should start fan-out dependencies with root first', async () => {
      // Arrange — A → {B, C}
      const callOrder: string[] = [];
      const classA = createMockAdapterClass();
      classA.instance.start.mockImplementation(async () => { callOrder.push('A'); });
      const classB = createMockAdapterClass();
      classB.instance.start.mockImplementation(async () => { callOrder.push('B'); });
      const classC = createMockAdapterClass();
      classC.instance.start.mockImplementation(async () => { callOrder.push('C'); });

      app.addAdapter(classA.instance);
      app.addAdapter(classB.instance, { dependsOn: [classA.AdapterClass] });
      app.addAdapter(classC.instance, { dependsOn: [classA.AdapterClass] });

      // Act
      await app.start();

      // Assert
      expect(callOrder[0]).toBe('A');
      expect(callOrder).toContain('B');
      expect(callOrder).toContain('C');
    });

    it('should start fan-in dependencies with sink last', async () => {
      // Arrange — {A, B} → C
      const callOrder: string[] = [];
      const classA = createMockAdapterClass();
      classA.instance.start.mockImplementation(async () => { callOrder.push('A'); });
      const classB = createMockAdapterClass();
      classB.instance.start.mockImplementation(async () => { callOrder.push('B'); });
      const classC = createMockAdapterClass();
      classC.instance.start.mockImplementation(async () => { callOrder.push('C'); });

      app.addAdapter(classA.instance);
      app.addAdapter(classB.instance);
      app.addAdapter(classC.instance, { dependsOn: [classA.AdapterClass, classB.AdapterClass] });

      // Act
      await app.start();

      // Assert — C must be last
      expect(callOrder[2]).toBe('C');
      expect(callOrder.indexOf('A')).toBeLessThan(callOrder.indexOf('C'));
      expect(callOrder.indexOf('B')).toBeLessThan(callOrder.indexOf('C'));
    });

    it('should treat undefined dependsOn as standalone', async () => {
      // Arrange
      const callOrder: string[] = [];
      const adapterA = createMockAdapter();
      adapterA.start.mockImplementation(async () => { callOrder.push('A'); });
      const adapterB = createMockAdapter();
      adapterB.start.mockImplementation(async () => { callOrder.push('B'); });

      app.addAdapter(adapterA);
      app.addAdapter(adapterB);

      // Act
      await app.start();

      // Assert — registration order preserved (both standalone)
      expect(callOrder).toEqual(['A', 'B']);
    });

    it('should treat empty dependsOn array as standalone', async () => {
      // Arrange
      const callOrder: string[] = [];
      const adapterA = createMockAdapter();
      adapterA.start.mockImplementation(async () => { callOrder.push('A'); });
      const adapterB = createMockAdapter();
      adapterB.start.mockImplementation(async () => { callOrder.push('B'); });

      app.addAdapter(adapterA, { dependsOn: [] });
      app.addAdapter(adapterB, { dependsOn: [] });

      // Act
      await app.start();

      // Assert — registration order preserved (both standalone)
      expect(callOrder).toEqual(['A', 'B']);
    });

    it('should preserve registration order within same topological level', async () => {
      // Arrange — B, C, D all depend on A; registered as B, C, D
      const callOrder: string[] = [];
      const classA = createMockAdapterClass();
      classA.instance.start.mockImplementation(async () => { callOrder.push('A'); });
      const classB = createMockAdapterClass();
      classB.instance.start.mockImplementation(async () => { callOrder.push('B'); });
      const classC = createMockAdapterClass();
      classC.instance.start.mockImplementation(async () => { callOrder.push('C'); });
      const classD = createMockAdapterClass();
      classD.instance.start.mockImplementation(async () => { callOrder.push('D'); });

      app.addAdapter(classA.instance);
      app.addAdapter(classB.instance, { dependsOn: [classA.AdapterClass] });
      app.addAdapter(classC.instance, { dependsOn: [classA.AdapterClass] });
      app.addAdapter(classD.instance, { dependsOn: [classA.AdapterClass] });

      // Act
      await app.start();

      // Assert — A first, then B, C, D in registration order
      expect(callOrder).toEqual(['A', 'B', 'C', 'D']);
    });

    it('should reorder adapters when registration order differs from topological order', async () => {
      // Arrange — register B(depends on A) first, then A
      const callOrder: string[] = [];
      const classA = createMockAdapterClass();
      classA.instance.start.mockImplementation(async () => { callOrder.push('A'); });
      const classB = createMockAdapterClass();
      classB.instance.start.mockImplementation(async () => { callOrder.push('B'); });

      app.addAdapter(classB.instance, { dependsOn: [classA.AdapterClass] });
      app.addAdapter(classA.instance);

      // Act
      await app.start();

      // Assert — topological order overrides registration: A before B
      expect(callOrder).toEqual(['A', 'B']);
    });

    it('should resolve string-based dependsOn by adapter name', async () => {
      // Arrange
      const callOrder: string[] = [];
      const adapterA = createMockAdapter();
      adapterA.start.mockImplementation(async () => { callOrder.push('A'); });
      const adapterB = createMockAdapter();
      adapterB.start.mockImplementation(async () => { callOrder.push('B'); });

      app.addAdapter(adapterA, { name: 'api' });
      app.addAdapter(adapterB, { dependsOn: ['api'] });

      // Act
      await app.start();

      // Assert
      expect(callOrder).toEqual(['A', 'B']);
    });

    it('should support mixed class-reference and string dependsOn', async () => {
      // Arrange
      const callOrder: string[] = [];
      const classA = createMockAdapterClass();
      classA.instance.start.mockImplementation(async () => { callOrder.push('A'); });
      const adapterB = createMockAdapter();
      adapterB.start.mockImplementation(async () => { callOrder.push('B'); });
      const adapterC = createMockAdapter();
      adapterC.start.mockImplementation(async () => { callOrder.push('C'); });

      app.addAdapter(classA.instance);
      app.addAdapter(adapterB, { name: 'named-b' });
      app.addAdapter(adapterC, { dependsOn: [classA.AdapterClass, 'named-b'] });

      // Act
      await app.start();

      // Assert — C must be last
      expect(callOrder.indexOf('A')).toBeLessThan(callOrder.indexOf('C'));
      expect(callOrder.indexOf('B')).toBeLessThan(callOrder.indexOf('C'));
    });

    it('should depend on all instances when class-reference used for multi-instance adapter', async () => {
      // Arrange — two instances of same class, third depends on class ref
      const callOrder: string[] = [];
      const { AdapterClass, instance: instanceA } = createMockAdapterClass();
      instanceA.start.mockImplementation(async () => { callOrder.push('A'); });
      const instanceB = new AdapterClass() as unknown as Adapter & {
        start: Mock<(ctx: Context) => Promise<void>>;
        stop: Mock<() => Promise<void>>;
      };
      instanceB.start = mock(async () => { callOrder.push('B'); });
      instanceB.stop = mock(() => Promise.resolve());
      const adapterC = createMockAdapter();
      adapterC.start.mockImplementation(async () => { callOrder.push('C'); });

      app.addAdapter(instanceA, { name: 'api' });
      app.addAdapter(instanceB as Adapter, { name: 'admin' });
      app.addAdapter(adapterC, { dependsOn: [AdapterClass] });

      // Act
      await app.start();

      // Assert — both A and B started before C
      expect(callOrder.indexOf('A')).toBeLessThan(callOrder.indexOf('C'));
      expect(callOrder.indexOf('B')).toBeLessThan(callOrder.indexOf('C'));
    });
  });

  // ── dependsOn — cycle detection ─────────────────────────────

  describe('dependsOn - cycle detection', () => {
    it('should detect cycle between two adapters', async () => {
      // Arrange
      const classA = createMockAdapterClass();
      const classB = createMockAdapterClass();

      app.addAdapter(classA.instance, { dependsOn: [classB.AdapterClass] });
      app.addAdapter(classB.instance, { dependsOn: [classA.AdapterClass] });

      // Act & Assert
      await expect(app.start()).rejects.toThrow(/cycle/i);
    });

    it('should detect self-referencing cycle', async () => {
      // Arrange
      const classA = createMockAdapterClass();

      app.addAdapter(classA.instance, { dependsOn: [classA.AdapterClass] });

      // Act & Assert
      await expect(app.start()).rejects.toThrow(/cycle/i);
    });

    it('should detect cycle in 3-node graph', async () => {
      // Arrange — A→B→C→A
      const classA = createMockAdapterClass();
      const classB = createMockAdapterClass();
      const classC = createMockAdapterClass();

      app.addAdapter(classA.instance, { dependsOn: [classC.AdapterClass] });
      app.addAdapter(classB.instance, { dependsOn: [classA.AdapterClass] });
      app.addAdapter(classC.instance, { dependsOn: [classB.AdapterClass] });

      // Act & Assert
      await expect(app.start()).rejects.toThrow(/cycle/i);
    });
  });

  // ── dependsOn — start graceful cleanup ──────────────────────

  describe('dependsOn - start graceful cleanup', () => {
    it('should cleanup already-started adapters in reverse order when later adapter fails', async () => {
      // Arrange
      const stopOrder: string[] = [];
      const classA = createMockAdapterClass();
      classA.instance.stop.mockImplementation(async () => { stopOrder.push('A'); });
      const classB = createMockAdapterClass();
      classB.instance.stop.mockImplementation(async () => { stopOrder.push('B'); });
      const classC = createMockAdapterClass();
      classC.instance.start.mockImplementation(async () => { throw new Error('C failed'); });

      app.addAdapter(classA.instance);
      app.addAdapter(classB.instance, { dependsOn: [classA.AdapterClass] });
      app.addAdapter(classC.instance, { dependsOn: [classB.AdapterClass] });

      // Act
      try { await app.start(); } catch { /* expected */ }

      // Assert — cleanup reverse: B then A
      expect(stopOrder).toEqual(['B', 'A']);
    });

    it('should not cleanup any adapter when first adapter in topological order fails', async () => {
      // Arrange
      const classA = createMockAdapterClass();
      classA.instance.start.mockImplementation(async () => { throw new Error('A failed'); });
      const classB = createMockAdapterClass();

      app.addAdapter(classA.instance);
      app.addAdapter(classB.instance, { dependsOn: [classA.AdapterClass] });

      // Act
      try { await app.start(); } catch { /* expected */ }

      // Assert — no cleanup calls
      expect(classA.instance.stop).not.toHaveBeenCalled();
      expect(classB.instance.stop).not.toHaveBeenCalled();
      expect(classB.instance.start).not.toHaveBeenCalled();
    });

    it('should suppress cleanup errors and propagate original start error', async () => {
      // Arrange
      const classA = createMockAdapterClass();
      classA.instance.stop.mockImplementation(async () => { throw new Error('cleanup failed'); });
      const classB = createMockAdapterClass();
      classB.instance.start.mockImplementation(async () => { throw new Error('B start failed'); });

      app.addAdapter(classA.instance);
      app.addAdapter(classB.instance, { dependsOn: [classA.AdapterClass] });

      // Act & Assert — original error propagated, cleanup error suppressed
      await expect(app.start()).rejects.toThrow('B start failed');
    });

    it('should cleanup only started adapters in dependency chain when last fails', async () => {
      // Arrange — A→B→C, C fails; A and B were started
      const stopOrder: string[] = [];
      const classA = createMockAdapterClass();
      classA.instance.stop.mockImplementation(async () => { stopOrder.push('A'); });
      const classB = createMockAdapterClass();
      classB.instance.stop.mockImplementation(async () => { stopOrder.push('B'); });
      const classC = createMockAdapterClass();
      classC.instance.start.mockImplementation(async () => { throw new Error('C failed'); });
      classC.instance.stop.mockImplementation(async () => { stopOrder.push('C'); });

      app.addAdapter(classA.instance);
      app.addAdapter(classB.instance, { dependsOn: [classA.AdapterClass] });
      app.addAdapter(classC.instance, { dependsOn: [classB.AdapterClass] });

      // Act
      try { await app.start(); } catch { /* expected */ }

      // Assert — only A and B cleaned up (reverse), C never started so not cleaned
      expect(stopOrder).toEqual(['B', 'A']);
      expect(classC.instance.stop).not.toHaveBeenCalled();
    });

    it('should set started and stopped flags after start failure with cleanup', async () => {
      // Arrange
      const classA = createMockAdapterClass();
      const classB = createMockAdapterClass();
      classB.instance.start.mockImplementation(async () => { throw new Error('B failed'); });

      app.addAdapter(classA.instance);
      app.addAdapter(classB.instance, { dependsOn: [classA.AdapterClass] });

      // Act
      try { await app.start(); } catch { /* expected */ }

      // Assert — cannot start again (started=true)
      await expect(app.start()).rejects.toThrow(/already started/i);
      // Assert — cannot add adapter (started=true)
      expect(() => app.addAdapter(createMockAdapter())).toThrow(/started/i);
    });
  });

  // ── dependsOn — stop topological reverse ────────────────────

  describe('dependsOn - stop topological reverse', () => {
    it('should stop adapters in reverse topological order for A→B chain', async () => {
      // Arrange
      const stopOrder: string[] = [];
      const classA = createMockAdapterClass();
      classA.instance.stop.mockImplementation(async () => { stopOrder.push('A'); });
      const classB = createMockAdapterClass();
      classB.instance.stop.mockImplementation(async () => { stopOrder.push('B'); });

      app.addAdapter(classA.instance);
      app.addAdapter(classB.instance, { dependsOn: [classA.AdapterClass] });
      await app.start();

      // Act
      await app.stop();

      // Assert — B stops before A (reverse topological)
      expect(stopOrder).toEqual(['B', 'A']);
    });

    it('should stop adapters in reverse topological order for A→B→C chain', async () => {
      // Arrange
      const stopOrder: string[] = [];
      const classA = createMockAdapterClass();
      classA.instance.stop.mockImplementation(async () => { stopOrder.push('A'); });
      const classB = createMockAdapterClass();
      classB.instance.stop.mockImplementation(async () => { stopOrder.push('B'); });
      const classC = createMockAdapterClass();
      classC.instance.stop.mockImplementation(async () => { stopOrder.push('C'); });

      app.addAdapter(classA.instance);
      app.addAdapter(classB.instance, { dependsOn: [classA.AdapterClass] });
      app.addAdapter(classC.instance, { dependsOn: [classB.AdapterClass] });
      await app.start();

      // Act
      await app.stop();

      // Assert — C → B → A
      expect(stopOrder).toEqual(['C', 'B', 'A']);
    });

    it('should use topological reverse for stop even when it differs from registration reverse', async () => {
      // Arrange — register B first (depends on A), then A
      const stopOrder: string[] = [];
      const classA = createMockAdapterClass();
      classA.instance.stop.mockImplementation(async () => { stopOrder.push('A'); });
      const classB = createMockAdapterClass();
      classB.instance.stop.mockImplementation(async () => { stopOrder.push('B'); });

      app.addAdapter(classB.instance, { dependsOn: [classA.AdapterClass] });
      app.addAdapter(classA.instance);
      await app.start();

      // Act
      await app.stop();

      // Assert — topological reverse: B before A (not registration reverse: A before B)
      expect(stopOrder).toEqual(['B', 'A']);
    });
  });

  // ── dependsOn — lifecycle ───────────────────────────────────

  describe('dependsOn - lifecycle', () => {
    it('should complete full lifecycle in correct dependency order', async () => {
      // Arrange
      const startOrder: string[] = [];
      const stopOrder: string[] = [];
      const classA = createMockAdapterClass();
      classA.instance.start.mockImplementation(async () => { startOrder.push('A'); });
      classA.instance.stop.mockImplementation(async () => { stopOrder.push('A'); });
      const classB = createMockAdapterClass();
      classB.instance.start.mockImplementation(async () => { startOrder.push('B'); });
      classB.instance.stop.mockImplementation(async () => { stopOrder.push('B'); });

      app.addAdapter(classA.instance);
      app.addAdapter(classB.instance, { dependsOn: [classA.AdapterClass] });

      // Act
      await app.start();
      await app.stop();

      // Assert
      expect(startOrder).toEqual(['A', 'B']);
      expect(stopOrder).toEqual(['B', 'A']);
    });

    it('should throw on stop() after failed start with cleanup', async () => {
      // Arrange
      const classA = createMockAdapterClass();
      const classB = createMockAdapterClass();
      classB.instance.start.mockImplementation(async () => { throw new Error('B failed'); });

      app.addAdapter(classA.instance);
      app.addAdapter(classB.instance, { dependsOn: [classA.AdapterClass] });

      // Act
      try { await app.start(); } catch { /* expected */ }

      // Assert — stop should throw because app is in failed state
      await expect(app.stop()).rejects.toThrow(/already stopped/i);
    });
  });

  // ── Middleware Wiring via adapterConfig ──────────────────

  describe('middleware wiring', () => {
    function createWirableAdapter(): Adapter & {
      start: Mock<(ctx: Context) => Promise<void>>;
      stop: Mock<() => Promise<void>>;
      addMiddlewares: Mock<(hook: MiddlewareHook, middlewares: readonly ReturnType<typeof defineMiddleware>[]) => Adapter>;
    } {
      const self = {
        start: mock(() => Promise.resolve()),
        stop: mock(() => Promise.resolve()),
        addMiddlewares: mock(function () { return self; }),
      };

      return self;
    }

    function createWirableAdapterClass(): {
      AdapterClass: AdapterClass;
      instance: Adapter & {
        start: Mock<(ctx: Context) => Promise<void>>;
        stop: Mock<() => Promise<void>>;
        addMiddlewares: Mock<(hook: MiddlewareHook, middlewares: readonly ReturnType<typeof defineMiddleware>[]) => Adapter>;
      };
    } {
      const startFn = mock(() => Promise.resolve());
      const stopFn = mock(() => Promise.resolve());
      const addMiddlewaresFn = mock(function () { return instance; });

      class WirableMockAdapter {
        start = startFn;
        stop = stopFn;
        addMiddlewares = addMiddlewaresFn;
      }

      const instance = new WirableMockAdapter() as Adapter & {
        start: Mock<(ctx: Context) => Promise<void>>;
        stop: Mock<() => Promise<void>>;
        addMiddlewares: Mock<(hook: MiddlewareHook, middlewares: readonly ReturnType<typeof defineMiddleware>[]) => Adapter>;
      };

      return {
        AdapterClass: WirableMockAdapter as unknown as AdapterClass,
        instance,
      };
    }

    function createMiddleware() {
      return defineMiddleware(() => undefined);
    }

    it('should call addMiddlewares on adapter when adapterConfig has matching middleware', async () => {
      // Arrange
      const adapter = createWirableAdapter();
      const middlewareDef = createMiddleware();
      mockAdapterConfig = {
        // config key resolves to class name (Object) since no name provided
        [adapter.constructor.name]: {
          middlewares: {
            [MiddlewareHook.OnReceive]: [middlewareDef],
          },
        },
      };
      app.addAdapter(adapter);

      // Act
      await app.start();

      // Assert
      expect(adapter.addMiddlewares).toHaveBeenCalledTimes(1);
      expect(adapter.addMiddlewares).toHaveBeenCalledWith(
        MiddlewareHook.OnReceive,
        [middlewareDef],
      );
    });

    it('should call addMiddlewares for each hook when adapter has multiple hooks in config', async () => {
      // Arrange
      const adapter = createWirableAdapter();
      const mwOnReceive = createMiddleware();
      const mwPreHandle = createMiddleware();
      mockAdapterConfig = {
        [adapter.constructor.name]: {
          middlewares: {
            [MiddlewareHook.OnReceive]: [mwOnReceive],
            [MiddlewareHook.PreHandle]: [mwPreHandle],
          },
        },
      };
      app.addAdapter(adapter);

      // Act
      await app.start();

      // Assert
      expect(adapter.addMiddlewares).toHaveBeenCalledTimes(2);
    });

    it('should wire adapter by name when name is provided', async () => {
      // Arrange
      const adapter = createWirableAdapter();
      const mwDef = createMiddleware();
      mockAdapterConfig = {
        myhttp: { middlewares: { [MiddlewareHook.OnReceive]: [mwDef] } },
      };
      app.addAdapter(adapter, { name: 'myhttp' });

      // Act
      await app.start();

      // Assert
      expect(adapter.addMiddlewares).toHaveBeenCalledTimes(1);
    });

    it('should wire both adapters when adapterConfig has entries for each', async () => {
      // Arrange
      const httpAdapter = createWirableAdapter();
      const wsAdapter = createWirableAdapter();
      const httpMw = createMiddleware();
      const wsMw = createMiddleware();
      mockAdapterConfig = {
        http: { middlewares: { [MiddlewareHook.OnReceive]: [httpMw] } },
        ws: { middlewares: { [MiddlewareHook.OnReceive]: [wsMw] } },
      };
      app.addAdapter(httpAdapter, { name: 'http' });
      app.addAdapter(wsAdapter, { name: 'ws' });

      // Act
      await app.start();

      // Assert
      expect(httpAdapter.addMiddlewares).toHaveBeenCalledTimes(1);
      expect(wsAdapter.addMiddlewares).toHaveBeenCalledTimes(1);
    });

    it('should start without wiring when adapterConfig is undefined', async () => {
      // Arrange
      const adapter = createWirableAdapter();
      mockAdapterConfig = undefined;
      app.addAdapter(adapter);

      // Act
      await app.start();

      // Assert
      expect(adapter.addMiddlewares).not.toHaveBeenCalled();
      expect(adapter.start).toHaveBeenCalledTimes(1);
    });

    it('should skip adapter when its config key is not in adapterConfig', async () => {
      // Arrange
      const adapter = createWirableAdapter();
      mockAdapterConfig = {
        ws: { middlewares: { [MiddlewareHook.OnReceive]: [createMiddleware()] } },
      };
      app.addAdapter(adapter, { name: 'http' });

      // Act
      await app.start();

      // Assert
      expect(adapter.addMiddlewares).not.toHaveBeenCalled();
    });

    it('should skip hook when middleware array is empty', async () => {
      // Arrange
      const adapter = createWirableAdapter();
      mockAdapterConfig = {
        http: { middlewares: { [MiddlewareHook.OnReceive]: [] } },
      };
      app.addAdapter(adapter, { name: 'http' });

      // Act
      await app.start();

      // Assert
      expect(adapter.addMiddlewares).not.toHaveBeenCalled();
    });

    it('should skip middleware field when it is undefined in config', async () => {
      // Arrange
      const adapter = createWirableAdapter();
      mockAdapterConfig = {
        http: {},
      };
      app.addAdapter(adapter, { name: 'http' });

      // Act
      await app.start();

      // Assert
      expect(adapter.addMiddlewares).not.toHaveBeenCalled();
    });

    it('should not wire when no adapters registered and config exists', async () => {
      // Arrange
      mockAdapterConfig = {
        http: { middlewares: { [MiddlewareHook.OnReceive]: [createMiddleware()] } },
      };

      // Act & Assert — no throw, no wiring
      await expect(app.start()).resolves.toBeUndefined();
    });

    it('should not wire when config middlewares is empty object', async () => {
      // Arrange
      const adapter = createWirableAdapter();
      mockAdapterConfig = {
        http: { middlewares: {} },
      };
      app.addAdapter(adapter, { name: 'http' });

      // Act
      await app.start();

      // Assert
      expect(adapter.addMiddlewares).not.toHaveBeenCalled();
    });

    it('should wire only matching adapter when one matches config and another does not', async () => {
      // Arrange
      const httpAdapter = createWirableAdapter();
      const wsAdapter = createWirableAdapter();
      mockAdapterConfig = {
        http: { middlewares: { [MiddlewareHook.OnReceive]: [createMiddleware()] } },
      };
      app.addAdapter(httpAdapter, { name: 'http' });
      app.addAdapter(wsAdapter, { name: 'ws' });

      // Act
      await app.start();

      // Assert
      expect(httpAdapter.addMiddlewares).toHaveBeenCalledTimes(1);
      expect(wsAdapter.addMiddlewares).not.toHaveBeenCalled();
    });

    it('should wire adapters in topological order', async () => {
      // Arrange — B depends on A, so A wires first
      const wireOrder: string[] = [];
      const classA = createWirableAdapterClass();
      classA.instance.addMiddlewares.mockImplementation(function () {
        wireOrder.push('A');
        return classA.instance;
      });
      const classB = createWirableAdapterClass();
      classB.instance.addMiddlewares.mockImplementation(function () {
        wireOrder.push('B');
        return classB.instance;
      });
      mockAdapterConfig = {
        a: { middlewares: { [MiddlewareHook.OnReceive]: [createMiddleware()] } },
        b: { middlewares: { [MiddlewareHook.OnReceive]: [createMiddleware()] } },
      };
      app.addAdapter(classA.instance, { name: 'a' });
      app.addAdapter(classB.instance, { name: 'b', dependsOn: [classA.AdapterClass] });

      // Act
      await app.start();

      // Assert
      expect(wireOrder).toEqual(['A', 'B']);
    });

    it('should complete all wiring before any adapter.start is called', async () => {
      // Arrange
      const timeline: string[] = [];
      const adapter = createWirableAdapter();
      adapter.addMiddlewares.mockImplementation(function () {
        timeline.push('wire');
        return adapter;
      });
      adapter.start.mockImplementation(async () => { timeline.push('start'); });
      mockAdapterConfig = {
        http: { middlewares: { [MiddlewareHook.OnReceive]: [createMiddleware()] } },
      };
      app.addAdapter(adapter, { name: 'http' });

      // Act
      await app.start();

      // Assert — wire happened and came before start
      expect(adapter.addMiddlewares).toHaveBeenCalledTimes(1);
      expect(timeline).toContain('wire');
      expect(timeline.indexOf('wire')).toBeLessThan(timeline.indexOf('start'));
    });

    it('should complete full lifecycle when wiring succeeds', async () => {
      // Arrange
      const adapter = createWirableAdapter();
      mockAdapterConfig = {
        http: { middlewares: { [MiddlewareHook.OnReceive]: [createMiddleware()] } },
      };
      app.addAdapter(adapter, { name: 'http' });

      // Act
      await app.start();
      await app.stop();

      // Assert
      expect(adapter.addMiddlewares).toHaveBeenCalledTimes(1);
      expect(adapter.start).toHaveBeenCalledTimes(1);
      expect(adapter.stop).toHaveBeenCalledTimes(1);
    });

    it('should cleanup already-started adapters when start fails after wiring', async () => {
      // Arrange — A wires+starts ok, B wires+starts throws
      const classA = createWirableAdapterClass();
      const classB = createWirableAdapterClass();
      classB.instance.start.mockImplementation(async () => { throw new Error('B failed'); });
      mockAdapterConfig = {
        a: { middlewares: { [MiddlewareHook.OnReceive]: [createMiddleware()] } },
        b: { middlewares: { [MiddlewareHook.OnReceive]: [createMiddleware()] } },
      };
      app.addAdapter(classA.instance, { name: 'a' });
      app.addAdapter(classB.instance, { name: 'b', dependsOn: [classA.AdapterClass] });

      // Act
      await expect(app.start()).rejects.toThrow('B failed');

      // Assert — A was started and cleaned up
      expect(classA.instance.start).toHaveBeenCalledTimes(1);
      expect(classA.instance.stop).toHaveBeenCalledTimes(1);
      expect(classA.instance.addMiddlewares).toHaveBeenCalledTimes(1);
      expect(classB.instance.addMiddlewares).toHaveBeenCalledTimes(1);
    });
  });
});
