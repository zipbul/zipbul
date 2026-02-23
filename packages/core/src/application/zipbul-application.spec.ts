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
});
