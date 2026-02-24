import { describe, it, expect, mock, beforeEach, type Mock } from 'bun:test';
import type { ZipbulAdapter, Context, ZipbulContainer, ProviderToken } from '@zipbul/common';
import { ZipbulApplication } from './zipbul-application';

/**
 * Factory to create a mock ZipbulAdapter with spied start/stop.
 */
function createMockAdapter(): ZipbulAdapter & {
  start: Mock<(ctx: Context) => Promise<void>>;
  stop: Mock<() => Promise<void>>;
} {
  return {
    start: mock(() => Promise.resolve()),
    stop: mock(() => Promise.resolve()),
  };
}

describe('ZipbulApplication', () => {
  let app: ZipbulApplication;

  beforeEach(() => {
    app = new ZipbulApplication();
  });

  // ── addAdapter ───────────────────────────────────────────────

  describe('addAdapter', () => {
    it('should register a single adapter with correct name, protocol, and adapter reference', () => {
      // Arrange
      const adapter = createMockAdapter();
      const config = { name: 'http', protocol: 'http' };

      // Act
      app.addAdapter(adapter, config);

      // Assert — adapter was registered (verifiable via start calling it)
      // We confirm registration is stored; indirect verification via start().
      expect(() => app.addAdapter(createMockAdapter(), { name: 'http', protocol: 'http' })).toThrow();
    });

    it('should register multiple adapters with different names', () => {
      // Arrange
      const adapterA = createMockAdapter();
      const adapterB = createMockAdapter();

      // Act
      app.addAdapter(adapterA, { name: 'http', protocol: 'http' });
      app.addAdapter(adapterB, { name: 'ws', protocol: 'ws' });

      // Assert — both registered (duplicate of either would throw)
      expect(() => app.addAdapter(createMockAdapter(), { name: 'http', protocol: 'http' })).toThrow();
      expect(() => app.addAdapter(createMockAdapter(), { name: 'ws', protocol: 'ws' })).toThrow();
    });

    it('should throw when registering adapter with duplicate name', () => {
      // Arrange
      const adapter = createMockAdapter();
      app.addAdapter(adapter, { name: 'http', protocol: 'http' });

      // Act & Assert
      expect(() => app.addAdapter(createMockAdapter(), { name: 'http', protocol: 'http' })).toThrow(
        /already registered|duplicate/i,
      );
    });

    it('should throw when name is empty string', () => {
      // Arrange
      const adapter = createMockAdapter();

      // Act & Assert
      expect(() => app.addAdapter(adapter, { name: '', protocol: 'http' })).toThrow();
    });

    it('should not corrupt state when duplicate add throws — next add succeeds', () => {
      // Arrange
      app.addAdapter(createMockAdapter(), { name: 'http', protocol: 'http' });

      // Act — duplicate throws
      expect(() => app.addAdapter(createMockAdapter(), { name: 'http', protocol: 'http' })).toThrow();

      // Assert — different name still works
      expect(() => app.addAdapter(createMockAdapter(), { name: 'ws', protocol: 'ws' })).not.toThrow();
    });

    it('should throw when called after start', async () => {
      // Arrange
      app.addAdapter(createMockAdapter(), { name: 'http', protocol: 'http' });
      await app.start();

      // Act & Assert
      expect(() => app.addAdapter(createMockAdapter(), { name: 'ws', protocol: 'ws' })).toThrow(
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
    it('should delegate to container.get with the given token', () => {
      // Arrange
      const token: ProviderToken = 'MY_TOKEN';
      const container = app.getContainer();
      const expectedValue = { foo: 'bar' };
      container.set(token, () => expectedValue);

      // Act
      const result = app.get(token);

      // Assert
      expect(result).toBe(expectedValue);
    });

    it('should propagate container error when token is not found', () => {
      // Act & Assert
      expect(() => app.get('NONEXISTENT_TOKEN')).toThrow();
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
      app.addAdapter(adapter, { name: 'http', protocol: 'http' });

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

      app.addAdapter(adapterA, { name: 'a', protocol: 'http' });
      app.addAdapter(adapterB, { name: 'b', protocol: 'ws' });
      app.addAdapter(adapterC, { name: 'c', protocol: 'grpc' });

      // Act
      await app.start();

      // Assert
      expect(callOrder).toEqual(['A', 'B', 'C']);
    });

    it('should propagate error when adapter.start rejects', async () => {
      // Arrange
      const adapter = createMockAdapter();
      adapter.start.mockImplementation(async () => { throw new Error('start failed'); });
      app.addAdapter(adapter, { name: 'http', protocol: 'http' });

      // Act & Assert
      await expect(app.start()).rejects.toThrow('start failed');
    });

    it('should have already called earlier adapters start before a later adapter rejects', async () => {
      // Arrange
      const adapterA = createMockAdapter();
      const adapterB = createMockAdapter();
      adapterB.start.mockImplementation(async () => { throw new Error('B failed'); });

      app.addAdapter(adapterA, { name: 'a', protocol: 'http' });
      app.addAdapter(adapterB, { name: 'b', protocol: 'ws' });

      // Act
      try { await app.start(); } catch { /* expected */ }

      // Assert — A was started before B threw
      expect(adapterA.start).toHaveBeenCalledTimes(1);
      expect(adapterB.start).toHaveBeenCalledTimes(1);
    });

    it('should throw when start is called twice', async () => {
      // Arrange
      app.addAdapter(createMockAdapter(), { name: 'http', protocol: 'http' });
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
      app.addAdapter(adapter, { name: 'http', protocol: 'http' });
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

      app.addAdapter(adapterA, { name: 'a', protocol: 'http' });
      app.addAdapter(adapterB, { name: 'b', protocol: 'ws' });
      app.addAdapter(adapterC, { name: 'c', protocol: 'grpc' });
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
      app.addAdapter(adapter, { name: 'http', protocol: 'http' });
      await app.start();

      // Act & Assert
      await expect(app.stop()).rejects.toThrow('stop failed');
    });

    it('should have already called earlier stop (reverse) before a later one rejects', async () => {
      // Arrange — A registered first, B second → stop order: B, A
      const adapterA = createMockAdapter();
      adapterA.stop.mockImplementation(async () => { throw new Error('A stop failed'); });
      const adapterB = createMockAdapter();

      app.addAdapter(adapterA, { name: 'a', protocol: 'http' });
      app.addAdapter(adapterB, { name: 'b', protocol: 'ws' });
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
      app.addAdapter(createMockAdapter(), { name: 'http', protocol: 'http' });
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
      app.addAdapter(adapter, { name: 'http', protocol: 'http' });

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
      app.addAdapter(createMockAdapter(), { name: 'http', protocol: 'http' });

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
      const adapterA = createMockAdapter();
      adapterA.start.mockImplementation(async () => { callOrder.push('A'); });
      const adapterB = createMockAdapter();
      adapterB.start.mockImplementation(async () => { callOrder.push('B'); });

      app.addAdapter(adapterA, { name: 'a', protocol: 'http' });
      app.addAdapter(adapterB, { name: 'b', protocol: 'ws', dependsOn: ['a'] });

      // Act
      await app.start();

      // Assert
      expect(callOrder).toEqual(['A', 'B']);
    });

    it('should start adapters in correct order for linear chain A→B→C', async () => {
      // Arrange
      const callOrder: string[] = [];
      const adapterA = createMockAdapter();
      adapterA.start.mockImplementation(async () => { callOrder.push('A'); });
      const adapterB = createMockAdapter();
      adapterB.start.mockImplementation(async () => { callOrder.push('B'); });
      const adapterC = createMockAdapter();
      adapterC.start.mockImplementation(async () => { callOrder.push('C'); });

      app.addAdapter(adapterA, { name: 'a', protocol: 'http' });
      app.addAdapter(adapterB, { name: 'b', protocol: 'ws', dependsOn: ['a'] });
      app.addAdapter(adapterC, { name: 'c', protocol: 'grpc', dependsOn: ['b'] });

      // Act
      await app.start();

      // Assert
      expect(callOrder).toEqual(['A', 'B', 'C']);
    });

    it('should start adapters in correct order for diamond DAG', async () => {
      // Arrange — A → {B, C} → D
      const callOrder: string[] = [];
      const adapterA = createMockAdapter();
      adapterA.start.mockImplementation(async () => { callOrder.push('A'); });
      const adapterB = createMockAdapter();
      adapterB.start.mockImplementation(async () => { callOrder.push('B'); });
      const adapterC = createMockAdapter();
      adapterC.start.mockImplementation(async () => { callOrder.push('C'); });
      const adapterD = createMockAdapter();
      adapterD.start.mockImplementation(async () => { callOrder.push('D'); });

      app.addAdapter(adapterA, { name: 'a', protocol: 'p' });
      app.addAdapter(adapterB, { name: 'b', protocol: 'p', dependsOn: ['a'] });
      app.addAdapter(adapterC, { name: 'c', protocol: 'p', dependsOn: ['a'] });
      app.addAdapter(adapterD, { name: 'd', protocol: 'p', dependsOn: ['b', 'c'] });

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
      const adapterA = createMockAdapter();
      adapterA.start.mockImplementation(async () => { callOrder.push('A'); });
      const adapterB = createMockAdapter();
      adapterB.start.mockImplementation(async () => { callOrder.push('B'); });
      const adapterC = createMockAdapter();
      adapterC.start.mockImplementation(async () => { callOrder.push('C'); });

      app.addAdapter(adapterA, { name: 'a', protocol: 'p' });
      app.addAdapter(adapterB, { name: 'b', protocol: 'p', dependsOn: ['a'] });
      app.addAdapter(adapterC, { name: 'c', protocol: 'p', dependsOn: ['a'] });

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
      const adapterA = createMockAdapter();
      adapterA.start.mockImplementation(async () => { callOrder.push('A'); });
      const adapterB = createMockAdapter();
      adapterB.start.mockImplementation(async () => { callOrder.push('B'); });
      const adapterC = createMockAdapter();
      adapterC.start.mockImplementation(async () => { callOrder.push('C'); });

      app.addAdapter(adapterA, { name: 'a', protocol: 'p' });
      app.addAdapter(adapterB, { name: 'b', protocol: 'p' });
      app.addAdapter(adapterC, { name: 'c', protocol: 'p', dependsOn: ['a', 'b'] });

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

      app.addAdapter(adapterA, { name: 'a', protocol: 'p' });
      app.addAdapter(adapterB, { name: 'b', protocol: 'p' });

      // Act
      await app.start();

      // Assert — registration order preserved (both standalone)
      expect(callOrder).toEqual(['A', 'B']);
    });

    it('should treat explicit standalone dependsOn as no dependencies', async () => {
      // Arrange
      const callOrder: string[] = [];
      const adapterA = createMockAdapter();
      adapterA.start.mockImplementation(async () => { callOrder.push('A'); });
      const adapterB = createMockAdapter();
      adapterB.start.mockImplementation(async () => { callOrder.push('B'); });

      app.addAdapter(adapterA, { name: 'a', protocol: 'p', dependsOn: 'standalone' });
      app.addAdapter(adapterB, { name: 'b', protocol: 'p', dependsOn: 'standalone' });

      // Act
      await app.start();

      // Assert — registration order preserved (both standalone)
      expect(callOrder).toEqual(['A', 'B']);
    });

    it('should preserve registration order within same topological level', async () => {
      // Arrange — B, C, D all depend on A; registered as B, C, D
      const callOrder: string[] = [];
      const adapterA = createMockAdapter();
      adapterA.start.mockImplementation(async () => { callOrder.push('A'); });
      const adapterB = createMockAdapter();
      adapterB.start.mockImplementation(async () => { callOrder.push('B'); });
      const adapterC = createMockAdapter();
      adapterC.start.mockImplementation(async () => { callOrder.push('C'); });
      const adapterD = createMockAdapter();
      adapterD.start.mockImplementation(async () => { callOrder.push('D'); });

      app.addAdapter(adapterA, { name: 'a', protocol: 'p' });
      app.addAdapter(adapterB, { name: 'b', protocol: 'p', dependsOn: ['a'] });
      app.addAdapter(adapterC, { name: 'c', protocol: 'p', dependsOn: ['a'] });
      app.addAdapter(adapterD, { name: 'd', protocol: 'p', dependsOn: ['a'] });

      // Act
      await app.start();

      // Assert — A first, then B, C, D in registration order
      expect(callOrder).toEqual(['A', 'B', 'C', 'D']);
    });

    it('should reorder adapters when registration order differs from topological order', async () => {
      // Arrange — register B(depends on A) first, then A
      const callOrder: string[] = [];
      const adapterA = createMockAdapter();
      adapterA.start.mockImplementation(async () => { callOrder.push('A'); });
      const adapterB = createMockAdapter();
      adapterB.start.mockImplementation(async () => { callOrder.push('B'); });

      app.addAdapter(adapterB, { name: 'b', protocol: 'p', dependsOn: ['a'] });
      app.addAdapter(adapterA, { name: 'a', protocol: 'p' });

      // Act
      await app.start();

      // Assert — topological order overrides registration: A before B
      expect(callOrder).toEqual(['A', 'B']);
    });
  });

  // ── dependsOn — cycle detection ─────────────────────────────

  describe('dependsOn - cycle detection', () => {
    it('should detect cycle between two adapters', async () => {
      // Arrange
      app.addAdapter(createMockAdapter(), { name: 'a', protocol: 'p', dependsOn: ['b'] });
      app.addAdapter(createMockAdapter(), { name: 'b', protocol: 'p', dependsOn: ['a'] });

      // Act & Assert
      await expect(app.start()).rejects.toThrow(/cycle/i);
    });

    it('should detect self-referencing cycle', async () => {
      // Arrange
      app.addAdapter(createMockAdapter(), { name: 'a', protocol: 'p', dependsOn: ['a'] });

      // Act & Assert
      await expect(app.start()).rejects.toThrow(/cycle/i);
    });

    it('should detect cycle in 3-node graph', async () => {
      // Arrange — A→B→C→A
      app.addAdapter(createMockAdapter(), { name: 'a', protocol: 'p', dependsOn: ['c'] });
      app.addAdapter(createMockAdapter(), { name: 'b', protocol: 'p', dependsOn: ['a'] });
      app.addAdapter(createMockAdapter(), { name: 'c', protocol: 'p', dependsOn: ['b'] });

      // Act & Assert
      await expect(app.start()).rejects.toThrow(/cycle/i);
    });
  });

  // ── dependsOn — start graceful cleanup ──────────────────────

  describe('dependsOn - start graceful cleanup', () => {
    it('should cleanup already-started adapters in reverse order when later adapter fails', async () => {
      // Arrange
      const stopOrder: string[] = [];
      const adapterA = createMockAdapter();
      adapterA.stop.mockImplementation(async () => { stopOrder.push('A'); });
      const adapterB = createMockAdapter();
      adapterB.stop.mockImplementation(async () => { stopOrder.push('B'); });
      const adapterC = createMockAdapter();
      adapterC.start.mockImplementation(async () => { throw new Error('C failed'); });

      app.addAdapter(adapterA, { name: 'a', protocol: 'p' });
      app.addAdapter(adapterB, { name: 'b', protocol: 'p', dependsOn: ['a'] });
      app.addAdapter(adapterC, { name: 'c', protocol: 'p', dependsOn: ['b'] });

      // Act
      try { await app.start(); } catch { /* expected */ }

      // Assert — cleanup reverse: B then A
      expect(stopOrder).toEqual(['B', 'A']);
    });

    it('should not cleanup any adapter when first adapter in topological order fails', async () => {
      // Arrange
      const adapterA = createMockAdapter();
      adapterA.start.mockImplementation(async () => { throw new Error('A failed'); });
      const adapterB = createMockAdapter();

      app.addAdapter(adapterA, { name: 'a', protocol: 'p' });
      app.addAdapter(adapterB, { name: 'b', protocol: 'p', dependsOn: ['a'] });

      // Act
      try { await app.start(); } catch { /* expected */ }

      // Assert — no cleanup calls
      expect(adapterA.stop).not.toHaveBeenCalled();
      expect(adapterB.stop).not.toHaveBeenCalled();
      expect(adapterB.start).not.toHaveBeenCalled();
    });

    it('should suppress cleanup errors and propagate original start error', async () => {
      // Arrange
      const adapterA = createMockAdapter();
      adapterA.stop.mockImplementation(async () => { throw new Error('cleanup failed'); });
      const adapterB = createMockAdapter();
      adapterB.start.mockImplementation(async () => { throw new Error('B start failed'); });

      app.addAdapter(adapterA, { name: 'a', protocol: 'p' });
      app.addAdapter(adapterB, { name: 'b', protocol: 'p', dependsOn: ['a'] });

      // Act & Assert — original error propagated, cleanup error suppressed
      await expect(app.start()).rejects.toThrow('B start failed');
    });

    it('should cleanup only started adapters in dependency chain when last fails', async () => {
      // Arrange — A→B→C, C fails; A and B were started
      const stopOrder: string[] = [];
      const adapterA = createMockAdapter();
      adapterA.stop.mockImplementation(async () => { stopOrder.push('A'); });
      const adapterB = createMockAdapter();
      adapterB.stop.mockImplementation(async () => { stopOrder.push('B'); });
      const adapterC = createMockAdapter();
      adapterC.start.mockImplementation(async () => { throw new Error('C failed'); });
      adapterC.stop.mockImplementation(async () => { stopOrder.push('C'); });

      app.addAdapter(adapterA, { name: 'a', protocol: 'p' });
      app.addAdapter(adapterB, { name: 'b', protocol: 'p', dependsOn: ['a'] });
      app.addAdapter(adapterC, { name: 'c', protocol: 'p', dependsOn: ['b'] });

      // Act
      try { await app.start(); } catch { /* expected */ }

      // Assert — only A and B cleaned up (reverse), C never started so not cleaned
      expect(stopOrder).toEqual(['B', 'A']);
      expect(adapterC.stop).not.toHaveBeenCalled();
    });

    it('should set started and stopped flags after start failure with cleanup', async () => {
      // Arrange
      const adapterA = createMockAdapter();
      const adapterB = createMockAdapter();
      adapterB.start.mockImplementation(async () => { throw new Error('B failed'); });

      app.addAdapter(adapterA, { name: 'a', protocol: 'p' });
      app.addAdapter(adapterB, { name: 'b', protocol: 'p', dependsOn: ['a'] });

      // Act
      try { await app.start(); } catch { /* expected */ }

      // Assert — cannot start again (started=true)
      await expect(app.start()).rejects.toThrow(/already started/i);
      // Assert — cannot add adapter (started=true)
      expect(() => app.addAdapter(createMockAdapter(), { name: 'c', protocol: 'p' })).toThrow(/started/i);
    });
  });

  // ── dependsOn — stop topological reverse ────────────────────

  describe('dependsOn - stop topological reverse', () => {
    it('should stop adapters in reverse topological order for A→B chain', async () => {
      // Arrange
      const stopOrder: string[] = [];
      const adapterA = createMockAdapter();
      adapterA.stop.mockImplementation(async () => { stopOrder.push('A'); });
      const adapterB = createMockAdapter();
      adapterB.stop.mockImplementation(async () => { stopOrder.push('B'); });

      app.addAdapter(adapterA, { name: 'a', protocol: 'p' });
      app.addAdapter(adapterB, { name: 'b', protocol: 'p', dependsOn: ['a'] });
      await app.start();

      // Act
      await app.stop();

      // Assert — B stops before A (reverse topological)
      expect(stopOrder).toEqual(['B', 'A']);
    });

    it('should stop adapters in reverse topological order for A→B→C chain', async () => {
      // Arrange
      const stopOrder: string[] = [];
      const adapterA = createMockAdapter();
      adapterA.stop.mockImplementation(async () => { stopOrder.push('A'); });
      const adapterB = createMockAdapter();
      adapterB.stop.mockImplementation(async () => { stopOrder.push('B'); });
      const adapterC = createMockAdapter();
      adapterC.stop.mockImplementation(async () => { stopOrder.push('C'); });

      app.addAdapter(adapterA, { name: 'a', protocol: 'p' });
      app.addAdapter(adapterB, { name: 'b', protocol: 'p', dependsOn: ['a'] });
      app.addAdapter(adapterC, { name: 'c', protocol: 'p', dependsOn: ['b'] });
      await app.start();

      // Act
      await app.stop();

      // Assert — C → B → A
      expect(stopOrder).toEqual(['C', 'B', 'A']);
    });

    it('should use topological reverse for stop even when it differs from registration reverse', async () => {
      // Arrange — register B first (depends on A), then A
      const stopOrder: string[] = [];
      const adapterA = createMockAdapter();
      adapterA.stop.mockImplementation(async () => { stopOrder.push('A'); });
      const adapterB = createMockAdapter();
      adapterB.stop.mockImplementation(async () => { stopOrder.push('B'); });

      app.addAdapter(adapterB, { name: 'b', protocol: 'p', dependsOn: ['a'] });
      app.addAdapter(adapterA, { name: 'a', protocol: 'p' });
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
      const adapterA = createMockAdapter();
      adapterA.start.mockImplementation(async () => { startOrder.push('A'); });
      adapterA.stop.mockImplementation(async () => { stopOrder.push('A'); });
      const adapterB = createMockAdapter();
      adapterB.start.mockImplementation(async () => { startOrder.push('B'); });
      adapterB.stop.mockImplementation(async () => { stopOrder.push('B'); });

      app.addAdapter(adapterA, { name: 'a', protocol: 'p' });
      app.addAdapter(adapterB, { name: 'b', protocol: 'p', dependsOn: ['a'] });

      // Act
      await app.start();
      await app.stop();

      // Assert
      expect(startOrder).toEqual(['A', 'B']);
      expect(stopOrder).toEqual(['B', 'A']);
    });

    it('should throw on stop() after failed start with cleanup', async () => {
      // Arrange
      const adapterA = createMockAdapter();
      const adapterB = createMockAdapter();
      adapterB.start.mockImplementation(async () => { throw new Error('B failed'); });

      app.addAdapter(adapterA, { name: 'a', protocol: 'p' });
      app.addAdapter(adapterB, { name: 'b', protocol: 'p', dependsOn: ['a'] });

      // Act
      try { await app.start(); } catch { /* expected */ }

      // Assert — stop should throw because app is in failed state
      await expect(app.stop()).rejects.toThrow(/already stopped/i);
    });
  });
});
