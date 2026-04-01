import { describe, it, expect } from 'bun:test';
import { defineAdapter } from './define-adapter';
import type { AdapterEntryDecorators } from './types';
import { Adapter } from '@zipbul/core';
import type { Context } from '../interfaces';

// -- Test fixtures --

const controllerDeco = () => {};
const getDeco = () => {};
const postDeco = () => {};

class FakeAdapter extends Adapter {
  static readonly validPhases: ReadonlySet<string> = new Set();
  readonly decorators: AdapterEntryDecorators = {
    controller: controllerDeco,
    handler: [getDeco, postDeco],
  };

  handleResult() {}
  protected emergencyTeardown() {}
  protected async executePipeline() { return undefined as never; }
  applyMiddlewareConfig() {}
  async start(_context: Context): Promise<void> {}
  async stop(): Promise<void> {}
}

describe('defineAdapter', () => {
  it('should return the exact same class reference (===)', () => {
    // Arrange & Act
    const result = defineAdapter(FakeAdapter);

    // Assert
    expect(result).toBe(FakeAdapter);
  });

  it('should return identical results when called multiple times', () => {
    // Arrange & Act
    const result1 = defineAdapter(FakeAdapter);
    const result2 = defineAdapter(FakeAdapter);

    // Assert
    expect(result1).toBe(result2);
    expect(result1).toBe(FakeAdapter);
  });

  it('should preserve adapter class instance properties', () => {
    // Arrange
    const AdapterClass = defineAdapter(FakeAdapter);

    // Act
    const instance = new AdapterClass();

    // Assert
    expect(instance.decorators.controller).toBe(controllerDeco);
    expect(instance.decorators.handler).toEqual([getDeco, postDeco]);
  });
});
