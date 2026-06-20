import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { AdapterClass, ApplicationContext, ProviderToken, GuardDefinition } from '@zipbul/common';
import { defineMiddleware, defineGuard } from '@zipbul/common';

let mockAdapterConfig: Record<string, unknown> | undefined;

mock.module('@zipbul/baker', () => ({
  // baker 5.x: app DTOs register via a `new Baker()` instance (see src/baker.ts),
  // sealed by `appBaker.seal()` at startup. The stub instance only needs the two
  // members application code touches: the `Recipe` decorator and `seal`.
  Baker: class {
    Recipe = (target: unknown) => target;
    seal = () => {};
  },
  deserialize: async () => ({}),
  isBakerIssueSet: () => false,
}));

mock.module('../runtime/bootstrap-state', () => ({
  getBootstrapState: () => ({ adapterConfig: mockAdapterConfig }),
  clearMetadataRegistry: () => {},
}));

const { Application } = await import('./application');
type Application = InstanceType<typeof Application>;

function createMockAdapterClass() {
  const startFn = mock((_ctx?: ApplicationContext) => Promise.resolve());
  const stopFn = mock(() => Promise.resolve());
  const initializePipelineFn = mock(function () {});

  class MockAdapter {
    start = startFn;
    stop = stopFn;
    initializePipeline = initializePipelineFn;
  }

  return {
    AdapterClass: MockAdapter as unknown as AdapterClass,
    startFn,
    stopFn,
    initializePipelineFn,
  };
}

function createMockAdapter() {
  return createMockAdapterClass().AdapterClass;
}

function createWirableAdapterClass() {
  const startFn = mock(() => Promise.resolve());
  const stopFn = mock(() => Promise.resolve());


  const applyMiddlewareConfigFn = mock(function () {});
  const initializePipelineFn = mock(function () {});

  class WirableMockAdapter {
    constructor() {}
    start = startFn;
    stop = stopFn;
    applyMiddlewareConfig = applyMiddlewareConfigFn;
    initializePipeline = initializePipelineFn;
  }

  return {
    AdapterClass: WirableMockAdapter as unknown as AdapterClass,
    startFn,
    stopFn,
    applyMiddlewareConfigFn,
    initializePipelineFn,
  };
}

describe('Application', () => {
  let app: Application;

  beforeEach(() => {
    mockAdapterConfig = undefined;
    app = new Application();
  });

  describe('attach', () => {
    it('should register a single adapter without config', () => {
      const adapterClass = createMockAdapter();
      expect(() => app.attach(adapterClass)).not.toThrow();
    });

    it('should register a single adapter with name', () => {
      const adapterClass = createMockAdapter();
      expect(() => app.attach(adapterClass, { name: 'http' })).not.toThrow();
    });

    it('should throw when same class registered twice without name', () => {
      const { AdapterClass } = createMockAdapterClass();
      app.attach(AdapterClass);
      expect(() => app.attach(AdapterClass)).toThrow(/registered multiple times/i);
    });

    it('should allow same class registered twice with different names', () => {
      const { AdapterClass } = createMockAdapterClass();
      app.attach(AdapterClass, { name: 'api' });
      expect(() => app.attach(AdapterClass, { name: 'admin' })).not.toThrow();
    });

    it('should throw when same class registered twice with duplicate name', () => {
      const { AdapterClass } = createMockAdapterClass();
      app.attach(AdapterClass, { name: 'api' });
      expect(() => app.attach(AdapterClass, { name: 'api' })).toThrow(/already registered/i);
    });

    it('should throw when second registration of same class omits name while first has name', () => {
      const { AdapterClass } = createMockAdapterClass();
      app.attach(AdapterClass, { name: 'api' });
      expect(() => app.attach(AdapterClass)).toThrow(/registered multiple times/i);
    });

    it('should register multiple adapters of different classes without names', () => {
      const adapterClassA = createMockAdapter();
      const adapterClassB = createMockAdapter();
      app.attach(adapterClassA);
      expect(() => app.attach(adapterClassB)).not.toThrow();
    });

    it('should not corrupt state when duplicate add throws — next add succeeds', () => {
      const { AdapterClass } = createMockAdapterClass();
      app.attach(AdapterClass);
      expect(() => app.attach(AdapterClass)).toThrow();
      expect(() => app.attach(createMockAdapter())).not.toThrow();
    });

    it('should throw when called after start', async () => {
      app.attach(createMockAdapter());
      await app.start();
      expect(() => app.attach(createMockAdapter())).toThrow(/started|running|cannot attach/i);
    });
  });

  describe('getContainer', () => {
    it('should return a ZipbulContainer with has, get, keys methods', () => {
      const container = app.getContainer();
      expect(typeof container.has).toBe('function');
      expect(typeof container.get).toBe('function');
      expect(typeof container.keys).toBe('function');
    });

    it('should return the same container reference on every call', () => {
      const first = app.getContainer();
      const second = app.getContainer();
      expect(first).toBe(second);
    });
  });

  describe('get', () => {
    it('should delegate to container.get with the given token when visibleTo is all', () => {
      const token: ProviderToken = 'MY_TOKEN';
      const container = app.getContainer();
      const expectedValue = { foo: 'bar' };
      container.set(token, () => expectedValue, { scope: 'singleton', visibleTo: 'all' });
      const result = app.get(token);
      expect(result).toBe(expectedValue);
    });

    it('should propagate container error when token is not found', () => {
      expect(() => app.get('NONEXISTENT_TOKEN')).toThrow();
    });

    it('should throw when accessing non-singleton provider via app.get', () => {
      const container = app.getContainer();
      container.set('TRANSIENT_TOKEN', () => 'value', { scope: 'transient', visibleTo: 'all' });
      expect(() => app.get('TRANSIENT_TOKEN')).toThrow(/singleton/i);
    });

    it('should throw when accessing module-scoped provider via app.get', () => {
      const container = app.getContainer();
      container.set('MODULE_TOKEN', () => 'value', { scope: 'singleton', visibleTo: 'module' });
      expect(() => app.get('MODULE_TOKEN')).toThrow(/visibleTo/i);
    });
  });

  describe('start', () => {
    it('should resolve immediately when no adapters are registered', async () => {
      await expect(app.start()).resolves.toBeUndefined();
    });

    it('should call adapter.start with ApplicationContext for single adapter', async () => {
      const adapter = createMockAdapterClass();
      app.attach(adapter.AdapterClass);
      await app.start();
      expect(adapter.startFn).toHaveBeenCalledTimes(1);
      const ctx = adapter.startFn.mock.calls[0]![0] as ApplicationContext;
      expect(ctx.container).toBeDefined();
    });

    it('should call adapter.start in registration order for multiple adapters', async () => {
      const callOrder: string[] = [];
      const adapterA = createMockAdapterClass();
      adapterA.startFn.mockImplementation(async () => { callOrder.push('A'); });
      const adapterB = createMockAdapterClass();
      adapterB.startFn.mockImplementation(async () => { callOrder.push('B'); });
      const adapterC = createMockAdapterClass();
      adapterC.startFn.mockImplementation(async () => { callOrder.push('C'); });

      app.attach(adapterA.AdapterClass);
      app.attach(adapterB.AdapterClass);
      app.attach(adapterC.AdapterClass);
      await app.start();

      expect(callOrder).toEqual(['A', 'B', 'C']);
    });

    it('should propagate error when adapter.start rejects', async () => {
      const adapter = createMockAdapterClass();
      adapter.startFn.mockImplementation(async () => { throw new Error('start failed'); });
      app.attach(adapter.AdapterClass);
      await expect(app.start()).rejects.toThrow('start failed');
    });

    it('should have already called earlier adapters start before a later adapter rejects', async () => {
      const adapterA = createMockAdapterClass();
      const adapterB = createMockAdapterClass();
      adapterB.startFn.mockImplementation(async () => { throw new Error('B failed'); });

      app.attach(adapterA.AdapterClass);
      app.attach(adapterB.AdapterClass);

      try { await app.start(); } catch { /* expected */ }

      expect(adapterA.startFn).toHaveBeenCalledTimes(1);
      expect(adapterB.startFn).toHaveBeenCalledTimes(1);
    });

    it('should throw when start is called twice', async () => {
      app.attach(createMockAdapter());
      await app.start();
      await expect(app.start()).rejects.toThrow(/already started|double start/i);
    });
  });

  describe('stop', () => {
    it('should resolve immediately when no adapters are registered', async () => {
      await app.start();
      await expect(app.stop()).resolves.toBeUndefined();
    });

    it('should call adapter.stop for single adapter', async () => {
      const adapter = createMockAdapterClass();
      app.attach(adapter.AdapterClass);
      await app.start();
      await app.stop();
      expect(adapter.stopFn).toHaveBeenCalledTimes(1);
    });

    it('should call adapter.stop in reverse registration order for multiple adapters', async () => {
      const callOrder: string[] = [];
      const adapterA = createMockAdapterClass();
      adapterA.stopFn.mockImplementation(async () => { callOrder.push('A'); });
      const adapterB = createMockAdapterClass();
      adapterB.stopFn.mockImplementation(async () => { callOrder.push('B'); });
      const adapterC = createMockAdapterClass();
      adapterC.stopFn.mockImplementation(async () => { callOrder.push('C'); });

      app.attach(adapterA.AdapterClass);
      app.attach(adapterB.AdapterClass);
      app.attach(adapterC.AdapterClass);
      await app.start();
      await app.stop();

      expect(callOrder).toEqual(['C', 'B', 'A']);
    });

    it('should swallow error when adapter.stop rejects and continue cleanup', async () => {
      const adapter = createMockAdapterClass();
      adapter.stopFn.mockImplementation(async () => { throw new Error('stop failed'); });
      app.attach(adapter.AdapterClass);
      await app.start();
      await expect(app.stop()).resolves.toBeUndefined();
    });

    it('should have already called earlier stop (reverse) before a later one rejects', async () => {
      const adapterA = createMockAdapterClass();
      adapterA.stopFn.mockImplementation(async () => { throw new Error('A stop failed'); });
      const adapterB = createMockAdapterClass();

      app.attach(adapterA.AdapterClass);
      app.attach(adapterB.AdapterClass);
      await app.start();

      try { await app.stop(); } catch { /* expected */ }

      expect(adapterB.stopFn).toHaveBeenCalledTimes(1);
      expect(adapterA.stopFn).toHaveBeenCalledTimes(1);
    });

    it('should silently return when stop is called before start', async () => {
      await expect(app.stop()).resolves.toBeUndefined();
    });

    it('should silently return when stop is called twice', async () => {
      app.attach(createMockAdapter());
      await app.start();
      await app.stop();
      await expect(app.stop()).resolves.toBeUndefined();
    });
  });

  describe('lifecycle', () => {
    it('should complete full lifecycle: attach → start → stop', async () => {
      const adapter = createMockAdapterClass();
      app.attach(adapter.AdapterClass);
      await app.start();
      await app.stop();
      expect(adapter.startFn).toHaveBeenCalledTimes(1);
      expect(adapter.stopFn).toHaveBeenCalledTimes(1);
    });

    it('should return same container reference before and after start/stop', async () => {
      const before = app.getContainer();
      app.attach(createMockAdapter());

      const afterAdd = app.getContainer();
      await app.start();
      const afterStart = app.getContainer();
      await app.stop();
      const afterStop = app.getContainer();

      expect(before).toBe(afterAdd);
      expect(afterAdd).toBe(afterStart);
      expect(afterStart).toBe(afterStop);
    });
  });

  describe('dependsOn - topological sort', () => {
    it('should start adapters in dependency order when A→B chain exists', async () => {
      const callOrder: string[] = [];
      const classA = createMockAdapterClass();
      classA.startFn.mockImplementation(async () => { callOrder.push('A'); });
      const classB = createMockAdapterClass();
      classB.startFn.mockImplementation(async () => { callOrder.push('B'); });

      app.attach(classA.AdapterClass);
      app.attach(classB.AdapterClass, { dependsOn: [classA.AdapterClass] });

      await app.start();
      expect(callOrder).toEqual(['A', 'B']);
    });

    it('should start adapters in correct order for linear chain A→B→C', async () => {
      const callOrder: string[] = [];
      const classA = createMockAdapterClass();
      classA.startFn.mockImplementation(async () => { callOrder.push('A'); });
      const classB = createMockAdapterClass();
      classB.startFn.mockImplementation(async () => { callOrder.push('B'); });
      const classC = createMockAdapterClass();
      classC.startFn.mockImplementation(async () => { callOrder.push('C'); });

      app.attach(classA.AdapterClass);
      app.attach(classB.AdapterClass, { dependsOn: [classA.AdapterClass] });
      app.attach(classC.AdapterClass, { dependsOn: [classB.AdapterClass] });

      await app.start();
      expect(callOrder).toEqual(['A', 'B', 'C']);
    });

    it('should start adapters in correct order for diamond DAG', async () => {
      const callOrder: string[] = [];
      const classA = createMockAdapterClass();
      classA.startFn.mockImplementation(async () => { callOrder.push('A'); });
      const classB = createMockAdapterClass();
      classB.startFn.mockImplementation(async () => { callOrder.push('B'); });
      const classC = createMockAdapterClass();
      classC.startFn.mockImplementation(async () => { callOrder.push('C'); });
      const classD = createMockAdapterClass();
      classD.startFn.mockImplementation(async () => { callOrder.push('D'); });

      app.attach(classA.AdapterClass);
      app.attach(classB.AdapterClass, { dependsOn: [classA.AdapterClass] });
      app.attach(classC.AdapterClass, { dependsOn: [classA.AdapterClass] });
      app.attach(classD.AdapterClass, { dependsOn: [classB.AdapterClass, classC.AdapterClass] });

      await app.start();
      expect(callOrder[0]).toBe('A');
      expect(callOrder[3]).toBe('D');
      expect(callOrder.indexOf('B')).toBeLessThan(callOrder.indexOf('D'));
      expect(callOrder.indexOf('C')).toBeLessThan(callOrder.indexOf('D'));
    });

    it('should start fan-out dependencies with root first', async () => {
      const callOrder: string[] = [];
      const classA = createMockAdapterClass();
      classA.startFn.mockImplementation(async () => { callOrder.push('A'); });
      const classB = createMockAdapterClass();
      classB.startFn.mockImplementation(async () => { callOrder.push('B'); });
      const classC = createMockAdapterClass();
      classC.startFn.mockImplementation(async () => { callOrder.push('C'); });

      app.attach(classA.AdapterClass);
      app.attach(classB.AdapterClass, { dependsOn: [classA.AdapterClass] });
      app.attach(classC.AdapterClass, { dependsOn: [classA.AdapterClass] });

      await app.start();
      expect(callOrder[0]).toBe('A');
      expect(callOrder).toContain('B');
      expect(callOrder).toContain('C');
    });

    it('should start fan-in dependencies with sink last', async () => {
      const callOrder: string[] = [];
      const classA = createMockAdapterClass();
      classA.startFn.mockImplementation(async () => { callOrder.push('A'); });
      const classB = createMockAdapterClass();
      classB.startFn.mockImplementation(async () => { callOrder.push('B'); });
      const classC = createMockAdapterClass();
      classC.startFn.mockImplementation(async () => { callOrder.push('C'); });

      app.attach(classA.AdapterClass);
      app.attach(classB.AdapterClass);
      app.attach(classC.AdapterClass, { dependsOn: [classA.AdapterClass, classB.AdapterClass] });

      await app.start();
      expect(callOrder[2]).toBe('C');
      expect(callOrder.indexOf('A')).toBeLessThan(callOrder.indexOf('C'));
      expect(callOrder.indexOf('B')).toBeLessThan(callOrder.indexOf('C'));
    });

    it('should treat undefined dependsOn as standalone', async () => {
      const callOrder: string[] = [];
      const adapterA = createMockAdapterClass();
      adapterA.startFn.mockImplementation(async () => { callOrder.push('A'); });
      const adapterB = createMockAdapterClass();
      adapterB.startFn.mockImplementation(async () => { callOrder.push('B'); });

      app.attach(adapterA.AdapterClass);
      app.attach(adapterB.AdapterClass);

      await app.start();
      expect(callOrder).toEqual(['A', 'B']);
    });

    it('should treat empty dependsOn array as standalone', async () => {
      const callOrder: string[] = [];
      const adapterA = createMockAdapterClass();
      adapterA.startFn.mockImplementation(async () => { callOrder.push('A'); });
      const adapterB = createMockAdapterClass();
      adapterB.startFn.mockImplementation(async () => { callOrder.push('B'); });

      app.attach(adapterA.AdapterClass, { dependsOn: [] });
      app.attach(adapterB.AdapterClass, { dependsOn: [] });

      await app.start();
      expect(callOrder).toEqual(['A', 'B']);
    });

    it('should preserve registration order within same topological level', async () => {
      const callOrder: string[] = [];
      const classA = createMockAdapterClass();
      classA.startFn.mockImplementation(async () => { callOrder.push('A'); });
      const classB = createMockAdapterClass();
      classB.startFn.mockImplementation(async () => { callOrder.push('B'); });
      const classC = createMockAdapterClass();
      classC.startFn.mockImplementation(async () => { callOrder.push('C'); });
      const classD = createMockAdapterClass();
      classD.startFn.mockImplementation(async () => { callOrder.push('D'); });

      app.attach(classA.AdapterClass);
      app.attach(classB.AdapterClass, { dependsOn: [classA.AdapterClass] });
      app.attach(classC.AdapterClass, { dependsOn: [classA.AdapterClass] });
      app.attach(classD.AdapterClass, { dependsOn: [classA.AdapterClass] });

      await app.start();
      expect(callOrder).toEqual(['A', 'B', 'C', 'D']);
    });

    it('should reorder adapters when registration order differs from topological order', async () => {
      const callOrder: string[] = [];
      const classA = createMockAdapterClass();
      classA.startFn.mockImplementation(async () => { callOrder.push('A'); });
      const classB = createMockAdapterClass();
      classB.startFn.mockImplementation(async () => { callOrder.push('B'); });

      app.attach(classB.AdapterClass, { dependsOn: [classA.AdapterClass] });
      app.attach(classA.AdapterClass);

      await app.start();
      expect(callOrder).toEqual(['A', 'B']);
    });

    it('should resolve string-based dependsOn by adapter name', async () => {
      const callOrder: string[] = [];
      const adapterA = createMockAdapterClass();
      adapterA.startFn.mockImplementation(async () => { callOrder.push('A'); });
      const adapterB = createMockAdapterClass();
      adapterB.startFn.mockImplementation(async () => { callOrder.push('B'); });

      app.attach(adapterA.AdapterClass, { name: 'api' });
      app.attach(adapterB.AdapterClass, { dependsOn: ['api'] });

      await app.start();
      expect(callOrder).toEqual(['A', 'B']);
    });

    it('should support mixed class-reference and string dependsOn', async () => {
      const callOrder: string[] = [];
      const classA = createMockAdapterClass();
      classA.startFn.mockImplementation(async () => { callOrder.push('A'); });
      const adapterB = createMockAdapterClass();
      adapterB.startFn.mockImplementation(async () => { callOrder.push('B'); });
      const adapterC = createMockAdapterClass();
      adapterC.startFn.mockImplementation(async () => { callOrder.push('C'); });

      app.attach(classA.AdapterClass);
      app.attach(adapterB.AdapterClass, { name: 'named-b' });
      app.attach(adapterC.AdapterClass, { dependsOn: [classA.AdapterClass, 'named-b'] });

      await app.start();
      expect(callOrder.indexOf('A')).toBeLessThan(callOrder.indexOf('C'));
      expect(callOrder.indexOf('B')).toBeLessThan(callOrder.indexOf('C'));
    });

    it('should depend on all instances when class-reference used for multi-instance adapter', async () => {
      const callOrder: string[] = [];
      const { AdapterClass, startFn } = createMockAdapterClass();
      startFn.mockImplementation(async () => { callOrder.push('A or B'); });

      const adapterC = createMockAdapterClass();
      adapterC.startFn.mockImplementation(async () => { callOrder.push('C'); });

      app.attach(AdapterClass, { name: 'api' });
      app.attach(AdapterClass, { name: 'admin' });
      app.attach(adapterC.AdapterClass, { dependsOn: [AdapterClass] });

      await app.start();
      expect(callOrder.filter(x => x === 'A or B').length).toBe(2);
      expect(callOrder[2]).toBe('C');
    });
  });

  describe('dependsOn - cycle detection', () => {
    it('should detect cycle between two adapters', async () => {
      const classA = createMockAdapterClass();
      const classB = createMockAdapterClass();

      app.attach(classA.AdapterClass, { dependsOn: [classB.AdapterClass] });
      app.attach(classB.AdapterClass, { dependsOn: [classA.AdapterClass] });

      await expect(app.start()).rejects.toThrow(/cycle/i);
    });

    it('should detect self-referencing cycle', async () => {
      const classA = createMockAdapterClass();
      app.attach(classA.AdapterClass, { dependsOn: [classA.AdapterClass] });
      await expect(app.start()).rejects.toThrow(/cycle/i);
    });

    it('should detect cycle in 3-node graph', async () => {
      const classA = createMockAdapterClass();
      const classB = createMockAdapterClass();
      const classC = createMockAdapterClass();

      app.attach(classA.AdapterClass, { dependsOn: [classC.AdapterClass] });
      app.attach(classB.AdapterClass, { dependsOn: [classA.AdapterClass] });
      app.attach(classC.AdapterClass, { dependsOn: [classB.AdapterClass] });

      await expect(app.start()).rejects.toThrow(/cycle/i);
    });
  });

  describe('dependsOn - start graceful cleanup', () => {
    it('should cleanup already-started adapters in reverse order when later adapter fails', async () => {
      const stopOrder: string[] = [];
      const classA = createMockAdapterClass();
      classA.stopFn.mockImplementation(async () => { stopOrder.push('A'); });
      const classB = createMockAdapterClass();
      classB.stopFn.mockImplementation(async () => { stopOrder.push('B'); });
      const classC = createMockAdapterClass();
      classC.startFn.mockImplementation(async () => { throw new Error('C failed'); });

      app.attach(classA.AdapterClass);
      app.attach(classB.AdapterClass, { dependsOn: [classA.AdapterClass] });
      app.attach(classC.AdapterClass, { dependsOn: [classB.AdapterClass] });

      try { await app.start(); } catch { /* expected */ }

      expect(stopOrder).toEqual(['B', 'A']);
    });

    it('should not cleanup any adapter when first adapter in topological order fails', async () => {
      const classA = createMockAdapterClass();
      classA.startFn.mockImplementation(async () => { throw new Error('A failed'); });
      const classB = createMockAdapterClass();

      app.attach(classA.AdapterClass);
      app.attach(classB.AdapterClass, { dependsOn: [classA.AdapterClass] });

      try { await app.start(); } catch { /* expected */ }

      expect(classA.stopFn).not.toHaveBeenCalled();
      expect(classB.stopFn).not.toHaveBeenCalled();
      expect(classB.startFn).not.toHaveBeenCalled();
    });

    it('should suppress cleanup errors and propagate original start error', async () => {
      const classA = createMockAdapterClass();
      classA.stopFn.mockImplementation(async () => { throw new Error('cleanup failed'); });
      const classB = createMockAdapterClass();
      classB.startFn.mockImplementation(async () => { throw new Error('B start failed'); });

      app.attach(classA.AdapterClass);
      app.attach(classB.AdapterClass, { dependsOn: [classA.AdapterClass] });

      await expect(app.start()).rejects.toThrow('B start failed');
    });

    it('should cleanup only started adapters in dependency chain when last fails', async () => {
      const stopOrder: string[] = [];
      const classA = createMockAdapterClass();
      classA.stopFn.mockImplementation(async () => { stopOrder.push('A'); });
      const classB = createMockAdapterClass();
      classB.stopFn.mockImplementation(async () => { stopOrder.push('B'); });
      const classC = createMockAdapterClass();
      classC.startFn.mockImplementation(async () => { throw new Error('C failed'); });
      classC.stopFn.mockImplementation(async () => { stopOrder.push('C'); });

      app.attach(classA.AdapterClass);
      app.attach(classB.AdapterClass, { dependsOn: [classA.AdapterClass] });
      app.attach(classC.AdapterClass, { dependsOn: [classB.AdapterClass] });

      try { await app.start(); } catch { /* expected */ }

      expect(stopOrder).toEqual(['B', 'A']);
      expect(classC.stopFn).not.toHaveBeenCalled();
    });

    it('should set started and stopped flags after start failure with cleanup', async () => {
      const classA = createMockAdapterClass();
      const classB = createMockAdapterClass();
      classB.startFn.mockImplementation(async () => { throw new Error('B failed'); });

      app.attach(classA.AdapterClass);
      app.attach(classB.AdapterClass, { dependsOn: [classA.AdapterClass] });

      try { await app.start(); } catch { /* expected */ }

      await expect(app.start()).rejects.toThrow(/already started/i);
      expect(() => app.attach(createMockAdapter())).toThrow(/started/i);
    });
  });

  describe('dependsOn - stop topological reverse', () => {
    it('should stop adapters in reverse topological order for A→B chain', async () => {
      const stopOrder: string[] = [];
      const classA = createMockAdapterClass();
      classA.stopFn.mockImplementation(async () => { stopOrder.push('A'); });
      const classB = createMockAdapterClass();
      classB.stopFn.mockImplementation(async () => { stopOrder.push('B'); });

      app.attach(classA.AdapterClass);
      app.attach(classB.AdapterClass, { dependsOn: [classA.AdapterClass] });
      await app.start();
      await app.stop();

      expect(stopOrder).toEqual(['B', 'A']);
    });

    it('should stop adapters in reverse topological order for A→B→C chain', async () => {
      const stopOrder: string[] = [];
      const classA = createMockAdapterClass();
      classA.stopFn.mockImplementation(async () => { stopOrder.push('A'); });
      const classB = createMockAdapterClass();
      classB.stopFn.mockImplementation(async () => { stopOrder.push('B'); });
      const classC = createMockAdapterClass();
      classC.stopFn.mockImplementation(async () => { stopOrder.push('C'); });

      app.attach(classA.AdapterClass);
      app.attach(classB.AdapterClass, { dependsOn: [classA.AdapterClass] });
      app.attach(classC.AdapterClass, { dependsOn: [classB.AdapterClass] });
      await app.start();
      await app.stop();

      expect(stopOrder).toEqual(['C', 'B', 'A']);
    });

    it('should use topological reverse for stop even when it differs from registration reverse', async () => {
      const stopOrder: string[] = [];
      const classA = createMockAdapterClass();
      classA.stopFn.mockImplementation(async () => { stopOrder.push('A'); });
      const classB = createMockAdapterClass();
      classB.stopFn.mockImplementation(async () => { stopOrder.push('B'); });

      app.attach(classB.AdapterClass, { dependsOn: [classA.AdapterClass] });
      app.attach(classA.AdapterClass);
      await app.start();
      await app.stop();

      expect(stopOrder).toEqual(['B', 'A']);
    });
  });

  describe('dependsOn - lifecycle', () => {
    it('should complete full lifecycle in correct dependency order', async () => {
      const startOrder: string[] = [];
      const stopOrder: string[] = [];
      const classA = createMockAdapterClass();
      classA.startFn.mockImplementation(async () => { startOrder.push('A'); });
      classA.stopFn.mockImplementation(async () => { stopOrder.push('A'); });
      const classB = createMockAdapterClass();
      classB.startFn.mockImplementation(async () => { startOrder.push('B'); });
      classB.stopFn.mockImplementation(async () => { stopOrder.push('B'); });

      app.attach(classA.AdapterClass);
      app.attach(classB.AdapterClass, { dependsOn: [classA.AdapterClass] });

      await app.start();
      await app.stop();

      expect(startOrder).toEqual(['A', 'B']);
      expect(stopOrder).toEqual(['B', 'A']);
    });

    it('should silently return on stop() after failed start with cleanup', async () => {
      const classA = createMockAdapterClass();
      const classB = createMockAdapterClass();
      classB.startFn.mockImplementation(async () => { throw new Error('B failed'); });

      app.attach(classA.AdapterClass);
      app.attach(classB.AdapterClass, { dependsOn: [classA.AdapterClass] });

      try { await app.start(); } catch { /* expected */ }

      await expect(app.stop()).resolves.toBeUndefined();
    });
  });

  describe('middleware wiring', () => {
    function createMiddleware() {
      return defineMiddleware(() => () => undefined);
    }

    it('should call applyMiddlewareConfig on adapter when adapterConfig has matching middleware', async () => {
      const adapter = createWirableAdapterClass();
      const middlewareDef = createMiddleware();
      const middlewareConfig = { OnReceive: [middlewareDef] };
      mockAdapterConfig = {
        [adapter.AdapterClass.name]: {
          middlewares: middlewareConfig,
        },
      };
      app.attach(adapter.AdapterClass);
      await app.start();
      expect(adapter.applyMiddlewareConfigFn).toHaveBeenCalledTimes(1);
      expect(adapter.applyMiddlewareConfigFn).toHaveBeenCalledWith(middlewareConfig);
    });

    it('should call applyMiddlewareConfig once even when adapter has multiple phases in config', async () => {
      const adapter = createWirableAdapterClass();
      const mwOnReceive = createMiddleware();
      const mwPreHandle = createMiddleware();
      const middlewareConfig = { OnReceive: [mwOnReceive], PreHandle: [mwPreHandle] };
      mockAdapterConfig = {
        [adapter.AdapterClass.name]: {
          middlewares: middlewareConfig,
        },
      };
      app.attach(adapter.AdapterClass);
      await app.start();
      expect(adapter.applyMiddlewareConfigFn).toHaveBeenCalledTimes(1);
    });

    it('should wire adapter by name when name is provided', async () => {
      const adapter = createWirableAdapterClass();
      const mwDef = createMiddleware();
      mockAdapterConfig = {
        myhttp: { middlewares: { OnReceive: [mwDef] } },
      };
      app.attach(adapter.AdapterClass, { name: 'myhttp' });
      await app.start();
      expect(adapter.applyMiddlewareConfigFn).toHaveBeenCalledTimes(1);
    });

    it('should wire both adapters when adapterConfig has entries for each', async () => {
      const httpAdapter = createWirableAdapterClass();
      const wsAdapter = createWirableAdapterClass();
      const httpMw = createMiddleware();
      const wsMw = createMiddleware();
      mockAdapterConfig = {
        http: { middlewares: { OnReceive: [httpMw] } },
        ws: { middlewares: { OnReceive: [wsMw] } },
      };
      app.attach(httpAdapter.AdapterClass, { name: 'http' });
      app.attach(wsAdapter.AdapterClass, { name: 'ws' });
      await app.start();
      expect(httpAdapter.applyMiddlewareConfigFn).toHaveBeenCalledTimes(1);
      expect(wsAdapter.applyMiddlewareConfigFn).toHaveBeenCalledTimes(1);
    });

    it('should start without wiring when adapterConfig is undefined', async () => {
      const adapter = createWirableAdapterClass();
      mockAdapterConfig = undefined;
      app.attach(adapter.AdapterClass);
      await app.start();
      expect(adapter.applyMiddlewareConfigFn).not.toHaveBeenCalled();
      expect(adapter.startFn).toHaveBeenCalledTimes(1);
    });

    it('should skip adapter when its config key is not in adapterConfig', async () => {
      const adapter = createWirableAdapterClass();
      mockAdapterConfig = {
        ws: { middlewares: { OnReceive: [createMiddleware()] } },
      };
      app.attach(adapter.AdapterClass, { name: 'http' });
      await app.start();
      expect(adapter.applyMiddlewareConfigFn).not.toHaveBeenCalled();
    });

    it('should call applyMiddlewareConfig even when middleware array is empty (adapter handles it)', async () => {
      const adapter = createWirableAdapterClass();
      mockAdapterConfig = {
        http: { middlewares: { OnReceive: [] } },
      };
      app.attach(adapter.AdapterClass, { name: 'http' });
      await app.start();
      expect(adapter.applyMiddlewareConfigFn).toHaveBeenCalledTimes(1);
    });

    it('should skip middleware field when it is undefined in config', async () => {
      const adapter = createWirableAdapterClass();
      mockAdapterConfig = {
        http: {},
      };
      app.attach(adapter.AdapterClass, { name: 'http' });
      await app.start();
      expect(adapter.applyMiddlewareConfigFn).not.toHaveBeenCalled();
    });

    it('should not wire when no adapters registered and config exists', async () => {
      mockAdapterConfig = {
        http: { middlewares: { OnReceive: [createMiddleware()] } },
      };
      await expect(app.start()).resolves.toBeUndefined();
    });

    it('should call applyMiddlewareConfig even when middlewares is empty object', async () => {
      const adapter = createWirableAdapterClass();
      mockAdapterConfig = {
        http: { middlewares: {} },
      };
      app.attach(adapter.AdapterClass, { name: 'http' });
      await app.start();
      expect(adapter.applyMiddlewareConfigFn).toHaveBeenCalledTimes(1);
    });

    it('should wire only matching adapter when one matches config and another does not', async () => {
      const httpAdapter = createWirableAdapterClass();
      const wsAdapter = createWirableAdapterClass();
      mockAdapterConfig = {
        http: { middlewares: { OnReceive: [createMiddleware()] } },
      };
      app.attach(httpAdapter.AdapterClass, { name: 'http' });
      app.attach(wsAdapter.AdapterClass, { name: 'ws' });
      await app.start();
      expect(httpAdapter.applyMiddlewareConfigFn).toHaveBeenCalledTimes(1);
      expect(wsAdapter.applyMiddlewareConfigFn).not.toHaveBeenCalled();
    });

    it('should wire adapters in topological order', async () => {
      const wireOrder: string[] = [];
      const classA = createWirableAdapterClass();
      classA.applyMiddlewareConfigFn.mockImplementation(function () { wireOrder.push('A'); });
      const classB = createWirableAdapterClass();
      classB.applyMiddlewareConfigFn.mockImplementation(function () { wireOrder.push('B'); });

      mockAdapterConfig = {
        a: { middlewares: { OnReceive: [createMiddleware()] } },
        b: { middlewares: { OnReceive: [createMiddleware()] } },
      };
      app.attach(classA.AdapterClass, { name: 'a' });
      app.attach(classB.AdapterClass, { name: 'b', dependsOn: [classA.AdapterClass] });
      await app.start();
      expect(wireOrder).toEqual(['A', 'B']);
    });

    it('should complete all wiring before any adapter.start is called', async () => {
      const timeline: string[] = [];
      const adapter = createWirableAdapterClass();
      adapter.applyMiddlewareConfigFn.mockImplementation(function () { timeline.push('wire'); });
      adapter.startFn.mockImplementation(async () => { timeline.push('start'); });

      mockAdapterConfig = {
        http: { middlewares: { OnReceive: [createMiddleware()] } },
      };
      app.attach(adapter.AdapterClass, { name: 'http' });
      await app.start();

      expect(adapter.applyMiddlewareConfigFn).toHaveBeenCalledTimes(1);
      expect(timeline).toContain('wire');
      expect(timeline.indexOf('wire')).toBeLessThan(timeline.indexOf('start'));
    });

    it('should complete full lifecycle when wiring succeeds', async () => {
      const adapter = createWirableAdapterClass();
      mockAdapterConfig = {
        http: { middlewares: { OnReceive: [createMiddleware()] } },
      };
      app.attach(adapter.AdapterClass, { name: 'http' });
      await app.start();
      await app.stop();
      expect(adapter.applyMiddlewareConfigFn).toHaveBeenCalledTimes(1);
      expect(adapter.startFn).toHaveBeenCalledTimes(1);
      expect(adapter.stopFn).toHaveBeenCalledTimes(1);
    });

    it('should cleanup already-started adapters when start fails after wiring', async () => {
      const classA = createWirableAdapterClass();
      const classB = createWirableAdapterClass();
      classB.startFn.mockImplementation(async () => { throw new Error('B failed'); });
      mockAdapterConfig = {
        a: { middlewares: { OnReceive: [createMiddleware()] } },
        b: { middlewares: { OnReceive: [createMiddleware()] } },
      };
      app.attach(classA.AdapterClass, { name: 'a' });
      app.attach(classB.AdapterClass, { name: 'b', dependsOn: [classA.AdapterClass] });

      await expect(app.start()).rejects.toThrow('B failed');

      expect(classA.startFn).toHaveBeenCalledTimes(1);
      expect(classA.stopFn).toHaveBeenCalledTimes(1);
      expect(classA.applyMiddlewareConfigFn).toHaveBeenCalledTimes(1);
      expect(classB.applyMiddlewareConfigFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('guard wiring', () => {
    function createGuard(): GuardDefinition {
      return defineGuard(() => () => undefined);
    }

    function createGuardWirableAdapterClass() {
      const startFn = mock(() => Promise.resolve());
      const stopFn = mock(() => Promise.resolve());

      const applyGuardConfigFn = mock(function () {});
      const applyExceptionFilterConfigFn = mock(function () {});
      const applyMiddlewareConfigFn = mock(function () {});
      const initializePipelineFn = mock(function () {});

      class GuardWirableMockAdapter {
        start = startFn;
        stop = stopFn;
        applyGuardConfig = applyGuardConfigFn;
        applyExceptionFilterConfig = applyExceptionFilterConfigFn;
        applyMiddlewareConfig = applyMiddlewareConfigFn;
        initializePipeline = initializePipelineFn;
      }

      return {
        AdapterClass: GuardWirableMockAdapter as unknown as AdapterClass,
        startFn,
        stopFn,
        applyGuardConfigFn,
        applyExceptionFilterConfigFn,
        applyMiddlewareConfigFn,
        initializePipelineFn,
      };
    }

    it('should call adapter.applyGuardConfig when config.guards is non-empty', async () => {
      const adapter = createGuardWirableAdapterClass();
      const guard = createGuard();
      mockAdapterConfig = {
        [adapter.AdapterClass.name]: { guards: [guard] },
      };

      app.attach(adapter.AdapterClass);
      await app.start();

      expect(adapter.applyGuardConfigFn).toHaveBeenCalledTimes(1);
      expect(adapter.applyGuardConfigFn).toHaveBeenCalledWith([guard]);
    });

    it('should not call adapter.applyGuardConfig when config.guards is empty array', async () => {
      const adapter = createGuardWirableAdapterClass();
      mockAdapterConfig = {
        [adapter.AdapterClass.name]: { guards: [] },
      };

      app.attach(adapter.AdapterClass);
      await app.start();

      expect(adapter.applyGuardConfigFn).not.toHaveBeenCalled();
    });

    it('should not call adapter.applyGuardConfig when config.guards is undefined', async () => {
      const adapter = createGuardWirableAdapterClass();
      mockAdapterConfig = {
        [adapter.AdapterClass.name]: {},
      };

      app.attach(adapter.AdapterClass);
      await app.start();

      expect(adapter.applyGuardConfigFn).not.toHaveBeenCalled();
    });

    it('should wire guards after exceptionFilters', async () => {
      const wireOrder: string[] = [];
      const adapter = createGuardWirableAdapterClass();
      adapter.applyExceptionFilterConfigFn.mockImplementation(function () {
        wireOrder.push('exceptionFilters');
      });
      adapter.applyGuardConfigFn.mockImplementation(function () {
        wireOrder.push('guards');
      });

      class OrderTrackingAdapter {
        start = adapter.startFn;
        stop = adapter.stopFn;
        applyGuardConfig = adapter.applyGuardConfigFn;
        applyExceptionFilterConfig = adapter.applyExceptionFilterConfigFn;
        applyMiddlewareConfig = adapter.applyMiddlewareConfigFn;
        initializePipeline = adapter.initializePipelineFn;
      }

      const guard = createGuard();
      const exceptionFilter = { factory: () => () => {}, catchTypes: [] };
      mockAdapterConfig = {
        [OrderTrackingAdapter.name]: {
          guards: [guard],
          exceptionFilters: [exceptionFilter],
        },
      };

      app.attach(OrderTrackingAdapter as unknown as AdapterClass);
      await app.start();

      expect(wireOrder).toEqual(['exceptionFilters', 'guards']);
    });

    it('should resolve config key using adapter name when name is set', async () => {
      const adapter = createGuardWirableAdapterClass();
      const guard = createGuard();
      mockAdapterConfig = {
        'custom-name': { guards: [guard] },
      };

      app.attach(adapter.AdapterClass, { name: 'custom-name' });
      await app.start();

      expect(adapter.applyGuardConfigFn).toHaveBeenCalledTimes(1);
      expect(adapter.applyGuardConfigFn).toHaveBeenCalledWith([guard]);
    });
  });
});
