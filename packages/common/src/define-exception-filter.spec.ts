import { describe, it, expect } from 'bun:test';
import type { Err } from '@zipbul/result';
import { err } from '@zipbul/result';
import type { Context } from './interfaces';
import type { AdapterClass } from './adapter/types';
import type { ExceptionFilterHandlerFn } from './define-exception-filter';
import { Adapter } from '@zipbul/core';
import { defineExceptionFilter } from './define-exception-filter';

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

class TestError extends Error {}
class AnotherError extends Error {}

function noopHandler(_error: unknown, _ctx: Context): Err<unknown> {
  return err({ caught: true });
}
const noopFactory = () => noopHandler;

describe('defineExceptionFilter', () => {
  // ── Basic overload (catchTypes + factory) ───────────────────

  it('should return an ExceptionFilterDefinition with factory and catchTypes', () => {
    // Arrange & Act
    const def = defineExceptionFilter([TestError], noopFactory);

    // Assert
    expect(def.factory).toBe(noopFactory);
    expect(def.catchTypes).toEqual([TestError]);
  });

  it('should not set adapters when called without adapters', () => {
    // Arrange & Act
    const def = defineExceptionFilter([TestError], noopFactory);

    // Assert
    expect(def.adapters).toBeUndefined();
  });

  it('should return a frozen object when called with catchTypes and factory', () => {
    // Arrange & Act
    const def = defineExceptionFilter([TestError], noopFactory);

    // Assert
    expect(Object.isFrozen(def)).toBe(true);
  });

  it('should freeze the catchTypes array', () => {
    // Arrange & Act
    const def = defineExceptionFilter([TestError, AnotherError], noopFactory);

    // Assert
    expect(Object.isFrozen(def.catchTypes)).toBe(true);
  });

  // ── Catch-all (empty catchTypes) ───────────────────────────

  it('should accept empty catchTypes array for catch-all filter', () => {
    // Arrange & Act
    const def = defineExceptionFilter([], noopFactory);

    // Assert
    expect(def.catchTypes).toEqual([]);
    expect(def.factory).toBe(noopFactory);
  });

  // ── Adapter-specific overload ──────────────────────────────

  it('should return an ExceptionFilterDefinition with factory, catchTypes, and adapters', () => {
    // Arrange
    const adapters: readonly AdapterClass[] = [FakeAdapterA];

    // Act
    const def = defineExceptionFilter([TestError], adapters, noopFactory);

    // Assert
    expect(def.factory).toBe(noopFactory);
    expect(def.catchTypes).toEqual([TestError]);
    expect(def.adapters).toEqual([FakeAdapterA]);
  });

  it('should freeze the adapters array', () => {
    // Arrange & Act
    const def = defineExceptionFilter([TestError], [FakeAdapterA, FakeAdapterB], noopFactory);

    // Assert
    expect(Object.isFrozen(def.adapters)).toBe(true);
  });

  it('should return a frozen definition when called with adapters', () => {
    // Arrange & Act
    const def = defineExceptionFilter([TestError], [FakeAdapterA], noopFactory);

    // Assert
    expect(Object.isFrozen(def)).toBe(true);
  });

  it('should create a defensive copy of adapters array', () => {
    // Arrange
    const adapters: AdapterClass[] = [FakeAdapterA];

    // Act
    const def = defineExceptionFilter([TestError], adapters, noopFactory);
    adapters.push(FakeAdapterB);

    // Assert
    expect(def.adapters).toHaveLength(1);
    expect(def.adapters).toEqual([FakeAdapterA]);
  });

  it('should create a defensive copy of catchTypes array', () => {
    // Arrange
    const catchTypes = [TestError];

    // Act
    const def = defineExceptionFilter(catchTypes, noopFactory);
    catchTypes.push(AnotherError);

    // Assert
    expect(def.catchTypes).toHaveLength(1);
    expect(def.catchTypes).toEqual([TestError]);
  });

  it('should support multiple adapter classes', () => {
    // Arrange & Act
    const def = defineExceptionFilter([TestError], [FakeAdapterA, FakeAdapterB], noopFactory);

    // Assert
    expect(def.adapters).toEqual([FakeAdapterA, FakeAdapterB]);
  });

  // ── Error case ─────────────────────────────────────────────

  it('should throw when adapters specified but no factory provided', () => {
    // Arrange & Act & Assert
    expect(() =>
      defineExceptionFilter([TestError], [FakeAdapterA], undefined as never),
    ).toThrow(/factory function is required/i);
  });
});
