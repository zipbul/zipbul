import { describe, it, expect } from 'bun:test';
import type { AdapterContext } from './interfaces';
import type { AdapterClass } from './adapter/types';
import { Adapter } from '@zipbul/core';
import { contextKey, type ContextKey } from './context-key';
import { defineMiddleware } from './define-middleware';

class FakeAdapterA extends Adapter {
  static readonly validPhases: ReadonlySet<string> = new Set();
  readonly decorators = { controller: () => {}, handlers: [] };
  protected emergencyTeardown() {}
  protected async executePipeline() { return undefined as never; }
  async start() {}
  async stop() {}
}

class FakeAdapterB extends Adapter {
  static readonly validPhases: ReadonlySet<string> = new Set();
  readonly decorators = { controller: () => {}, handlers: [] };
  protected emergencyTeardown() {}
  protected async executePipeline() { return undefined as never; }
  async start() {}
  async stop() {}
}

function noopHandler(_ctx: AdapterContext) {}
const noopFactory = () => noopHandler;

describe('defineMiddleware', () => {
  // ── Factory-only overload ───────────────────────────────────

  it('should return a MiddlewareDefinition with factory when called with factory only', () => {
    // Arrange & Act
    const def = defineMiddleware(noopFactory);

    // Assert
    expect(def.factory).toBe(noopFactory);
  });

  it('should not set adapters when called with factory only', () => {
    // Arrange & Act
    const def = defineMiddleware(noopFactory);

    // Assert
    expect(def.adapters).toBeUndefined();
  });

  it('should return a frozen object when called with factory only', () => {
    // Arrange & Act
    const def = defineMiddleware(noopFactory);

    // Assert
    expect(Object.isFrozen(def)).toBe(true);
  });

  // ── Adapter + factory overload ──────────────────────────────

  it('should return a MiddlewareDefinition with factory and adapters when called with adapters and factory', () => {
    // Arrange
    const adapters: readonly AdapterClass[] = [FakeAdapterA];

    // Act
    const def = defineMiddleware(adapters, noopFactory);

    // Assert
    expect(def.factory).toBe(noopFactory);
    expect(def.adapters).toEqual([FakeAdapterA]);
  });

  it('should freeze the adapters array', () => {
    // Arrange & Act
    const def = defineMiddleware([FakeAdapterA, FakeAdapterB], noopFactory);

    // Assert
    expect(Object.isFrozen(def.adapters)).toBe(true);
  });

  it('should return a frozen definition when called with adapters and factory', () => {
    // Arrange & Act
    const def = defineMiddleware([FakeAdapterA], noopFactory);

    // Assert
    expect(Object.isFrozen(def)).toBe(true);
  });

  it('should create a defensive copy of adapters array', () => {
    // Arrange
    const adapters: AdapterClass[] = [FakeAdapterA];

    // Act
    const def = defineMiddleware(adapters, noopFactory);
    adapters.push(FakeAdapterB);

    // Assert
    expect(def.adapters).toHaveLength(1);
    expect(def.adapters).toEqual([FakeAdapterA]);
  });

  it('should support multiple adapter classes', () => {
    // Arrange & Act
    const def = defineMiddleware([FakeAdapterA, FakeAdapterB], noopFactory);

    // Assert
    expect(def.adapters).toEqual([FakeAdapterA, FakeAdapterB]);
  });

  it('should accept empty adapters array', () => {
    // Arrange & Act
    const def = defineMiddleware([], noopFactory);

    // Assert
    expect(def.adapters).toEqual([]);
    expect(def.factory).toBe(noopFactory);
  });

  // ── Error cases ────────────────────────────────────────────

  it('should throw when adapters are provided without factory', () => {
    // Arrange & Act & Assert
    expect(() => defineMiddleware([FakeAdapterA], undefined as never)).toThrow(
      'Factory function is required when adapters are specified.',
    );
  });

  // ── Config object overload ────────────────────────────────

  it('should accept a config object with factory only', () => {
    // Arrange & Act
    const def = defineMiddleware({ factory: noopFactory });

    // Assert
    expect(def.factory).toBe(noopFactory);
    expect(def.adapters).toBeUndefined();
    expect(def.provides).toBeUndefined();
  });

  it('should return a frozen object from config overload', () => {
    // Arrange & Act
    const def = defineMiddleware({ factory: noopFactory });

    // Assert
    expect(Object.isFrozen(def)).toBe(true);
  });

  it('should accept a config object with adapters', () => {
    // Arrange & Act
    const def = defineMiddleware({
      adapters: [FakeAdapterA],
      factory: noopFactory,
    });

    // Assert
    expect(def.factory).toBe(noopFactory);
    expect(def.adapters).toEqual([FakeAdapterA]);
    expect(Object.isFrozen(def.adapters)).toBe(true);
  });

  it('should accept a config object with provides', () => {
    // Arrange
    const keyA = contextKey<string>('test.a');
    const keyB = contextKey<number>('test.b');

    // Act
    const def = defineMiddleware({
      provides: [keyA, keyB],
      factory: noopFactory,
    });

    // Assert
    expect(def.provides).toEqual([keyA, keyB]);
    expect(Object.isFrozen(def.provides)).toBe(true);
  });

  it('should create a defensive copy of provides array', () => {
    // Arrange
    const keyA = contextKey<string>('test.a');
    const keyB = contextKey<number>('test.b');
    const provides: ContextKey<unknown>[] = [keyA];

    // Act
    const def = defineMiddleware({ provides, factory: noopFactory });
    provides.push(keyB);

    // Assert
    expect(def.provides).toHaveLength(1);
    expect(def.provides).toEqual([keyA]);
  });

  it('should accept a config object with adapters and provides', () => {
    // Arrange
    const key = contextKey<string>('test.key');

    // Act
    const def = defineMiddleware({
      adapters: [FakeAdapterA, FakeAdapterB],
      provides: [key],
      factory: noopFactory,
    });

    // Assert
    expect(def.factory).toBe(noopFactory);
    expect(def.adapters).toEqual([FakeAdapterA, FakeAdapterB]);
    expect(def.provides).toEqual([key]);
  });

  it('should create a defensive copy of adapters in config overload', () => {
    // Arrange
    const adapters: AdapterClass[] = [FakeAdapterA];

    // Act
    const def = defineMiddleware({ adapters, factory: noopFactory });
    adapters.push(FakeAdapterB);

    // Assert
    expect(def.adapters).toHaveLength(1);
    expect(def.adapters).toEqual([FakeAdapterA]);
  });

  it('should freeze adapters in config overload', () => {
    // Arrange & Act
    const def = defineMiddleware({
      adapters: [FakeAdapterA],
      factory: noopFactory,
    });

    // Assert
    expect(Object.isFrozen(def.adapters)).toBe(true);
  });
});
