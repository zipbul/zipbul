import { describe, it, expect } from 'bun:test';
import type { Context } from './interfaces';
import type { AdapterClass } from './adapter/types';
import { Adapter } from './adapter/adapter';
import { defineGuard } from './define-guard';

class FakeAdapterA extends Adapter {
  readonly decorators = { controller: () => {}, handler: [] };
  parseInput() {}
  resolveHandler() { return undefined; }
  handleResult() {}
  forceCloseConnection() {}

  async start() {}
  async stop() {}
}

class FakeAdapterB extends Adapter {
  readonly decorators = { controller: () => {}, handler: [] };
  parseInput() {}
  resolveHandler() { return undefined; }
  handleResult() {}
  forceCloseConnection() {}

  async start() {}
  async stop() {}
}

function noopHandler(_ctx: Context) {}

describe('defineGuard', () => {
  // ── Handler-only overload ───────────────────────────────────

  it('should return a GuardDefinition with handler when called with handler only', () => {
    // Arrange & Act
    const def = defineGuard(noopHandler);

    // Assert
    expect(def.handler).toBe(noopHandler);
  });

  it('should not set adapters when called with handler only', () => {
    // Arrange & Act
    const def = defineGuard(noopHandler);

    // Assert
    expect(def.adapters).toBeUndefined();
  });

  it('should return a frozen object when called with handler only', () => {
    // Arrange & Act
    const def = defineGuard(noopHandler);

    // Assert
    expect(Object.isFrozen(def)).toBe(true);
  });

  // ── Adapter + handler overload ──────────────────────────────

  it('should return a GuardDefinition with handler and adapters when called with adapters and handler', () => {
    // Arrange
    const adapters: readonly AdapterClass[] = [FakeAdapterA];

    // Act
    const def = defineGuard(adapters, noopHandler);

    // Assert
    expect(def.handler).toBe(noopHandler);
    expect(def.adapters).toEqual([FakeAdapterA]);
  });

  it('should freeze the adapters array', () => {
    // Arrange & Act
    const def = defineGuard([FakeAdapterA, FakeAdapterB], noopHandler);

    // Assert
    expect(Object.isFrozen(def.adapters)).toBe(true);
  });

  it('should return a frozen definition when called with adapters and handler', () => {
    // Arrange & Act
    const def = defineGuard([FakeAdapterA], noopHandler);

    // Assert
    expect(Object.isFrozen(def)).toBe(true);
  });

  it('should create a defensive copy of adapters array', () => {
    // Arrange
    const adapters: AdapterClass[] = [FakeAdapterA];

    // Act
    const def = defineGuard(adapters, noopHandler);
    adapters.push(FakeAdapterB);

    // Assert
    expect(def.adapters).toHaveLength(1);
    expect(def.adapters).toEqual([FakeAdapterA]);
  });

  it('should support multiple adapter classes', () => {
    // Arrange & Act
    const def = defineGuard([FakeAdapterA, FakeAdapterB], noopHandler);

    // Assert
    expect(def.adapters).toEqual([FakeAdapterA, FakeAdapterB]);
  });

  it('should accept empty adapters array', () => {
    // Arrange & Act
    const def = defineGuard([], noopHandler);

    // Assert
    expect(def.adapters).toEqual([]);
    expect(def.handler).toBe(noopHandler);
  });
});
