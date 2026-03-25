import { describe, it, expect } from 'bun:test';
import type { Context } from './interfaces';
import type { AdapterClass } from './adapter/types';
import type { GuardHandlerFn } from './define-guard';
import { Adapter } from './adapter/adapter';
import { defineGuard } from './define-guard';

class FakeAdapterA extends Adapter {
  static readonly validPhases: ReadonlySet<string> = new Set();
  readonly decorators = { controller: () => {}, handler: [] };
  handleResult() {}
  protected emergencyTeardown() {}
  protected async executePipeline() { return undefined as never; }
  applyMiddlewareConfig() {}
  async start() {}
  async stop() {}
}

class FakeAdapterB extends Adapter {
  static readonly validPhases: ReadonlySet<string> = new Set();
  readonly decorators = { controller: () => {}, handler: [] };
  handleResult() {}
  protected emergencyTeardown() {}
  protected async executePipeline() { return undefined as never; }
  applyMiddlewareConfig() {}
  async start() {}
  async stop() {}
}

function noopHandler(_ctx: Context) {}
const noopFactory = () => noopHandler;

describe('defineGuard', () => {
  // ── Factory-only overload ───────────────────────────────────

  it('should return a GuardDefinition with factory when called with factory only', () => {
    // Arrange & Act
    const def = defineGuard(noopFactory);

    // Assert
    expect(def.factory).toBe(noopFactory);
  });

  it('should not set adapters when called with factory only', () => {
    // Arrange & Act
    const def = defineGuard(noopFactory);

    // Assert
    expect(def.adapters).toBeUndefined();
  });

  it('should return a frozen object when called with factory only', () => {
    // Arrange & Act
    const def = defineGuard(noopFactory);

    // Assert
    expect(Object.isFrozen(def)).toBe(true);
  });

  // ── Adapter + factory overload ──────────────────────────────

  it('should return a GuardDefinition with factory and adapters when called with adapters and factory', () => {
    // Arrange
    const adapters: readonly AdapterClass[] = [FakeAdapterA];

    // Act
    const def = defineGuard(adapters, noopFactory);

    // Assert
    expect(def.factory).toBe(noopFactory);
    expect(def.adapters).toEqual([FakeAdapterA]);
  });

  it('should freeze the adapters array', () => {
    // Arrange & Act
    const def = defineGuard([FakeAdapterA, FakeAdapterB], noopFactory);

    // Assert
    expect(Object.isFrozen(def.adapters)).toBe(true);
  });

  it('should return a frozen definition when called with adapters and factory', () => {
    // Arrange & Act
    const def = defineGuard([FakeAdapterA], noopFactory);

    // Assert
    expect(Object.isFrozen(def)).toBe(true);
  });

  it('should create a defensive copy of adapters array', () => {
    // Arrange
    const adapters: AdapterClass[] = [FakeAdapterA];

    // Act
    const def = defineGuard(adapters, noopFactory);
    adapters.push(FakeAdapterB);

    // Assert
    expect(def.adapters).toHaveLength(1);
    expect(def.adapters).toEqual([FakeAdapterA]);
  });

  it('should support multiple adapter classes', () => {
    // Arrange & Act
    const def = defineGuard([FakeAdapterA, FakeAdapterB], noopFactory);

    // Assert
    expect(def.adapters).toEqual([FakeAdapterA, FakeAdapterB]);
  });

  it('should accept empty adapters array', () => {
    // Arrange & Act
    const def = defineGuard([], noopFactory);

    // Assert
    expect(def.adapters).toEqual([]);
    expect(def.factory).toBe(noopFactory);
  });
});
