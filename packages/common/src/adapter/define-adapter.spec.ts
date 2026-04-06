import { describe, it, expect } from 'bun:test';
import { defineAdapter } from './define-adapter';
import type { AdapterEntryDecorators } from './types';
import { Adapter } from '@zipbul/core';
import { contextKey } from '../context-key';
// -- Test fixtures --

const controllerDeco = () => {};
const getDeco = () => {};
const postDeco = () => {};

enum TestStep {
  Parse = 'Parse',
  Write = 'Write',
}

enum TestPhase {
  Before = 'Before',
  After = 'After',
}

class FakeContext {
  getType() { return 'test'; }
}

class FakeAdapter extends Adapter {
  static readonly validPhases: ReadonlySet<string> = new Set();
  readonly decorators: AdapterEntryDecorators = {
    controller: controllerDeco,
    handlers: [getDeco, postDeco],
  };

  protected emergencyTeardown() {}
  protected async executePipeline() { return undefined as never; }
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}

const bodyInput = contextKey<unknown>('test.body');
const paramsInput = contextKey<unknown>('test.params');

describe('defineAdapter', () => {
  it('should accept a config object and return a frozen result', () => {
    // Arrange & Act
    const result = defineAdapter({
      adapter: FakeAdapter,
      context: FakeContext,
      step: TestStep,
      pipeline: ['Parse', 'Handler', 'Write'],
    });

    // Assert
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('should preserve adapter class reference', () => {
    // Arrange & Act
    const result = defineAdapter({
      adapter: FakeAdapter,
      context: FakeContext,
      step: TestStep,
      pipeline: [],
    });

    // Assert
    expect(result.adapter).toBe(FakeAdapter);
  });

  it('should preserve context class reference', () => {
    // Arrange & Act
    const result = defineAdapter({
      adapter: FakeAdapter,
      context: FakeContext,
      step: TestStep,
      pipeline: [],
    });

    // Assert
    expect(result.context).toBe(FakeContext);
  });

  it('should preserve step enum reference', () => {
    // Arrange & Act
    const result = defineAdapter({
      adapter: FakeAdapter,
      context: FakeContext,
      step: TestStep,
      pipeline: [],
    });

    // Assert
    expect(result.step).toBe(TestStep);
  });

  it('should freeze the pipeline array', () => {
    // Arrange & Act
    const result = defineAdapter({
      adapter: FakeAdapter,
      context: FakeContext,
      step: TestStep,
      pipeline: ['Parse', 'Write'],
    });

    // Assert
    expect(Object.isFrozen(result.pipeline)).toBe(true);
    expect(result.pipeline).toEqual(['Parse', 'Write']);
  });

  it('should create a defensive copy of the pipeline array', () => {
    // Arrange
    const pipeline = ['Parse', 'Write'];

    // Act
    const result = defineAdapter({
      adapter: FakeAdapter,
      context: FakeContext,
      step: TestStep,
      pipeline,
    });
    pipeline.push('Extra');

    // Assert
    expect(result.pipeline).toHaveLength(2);
  });

  it('should include phase when provided', () => {
    // Arrange & Act
    const result = defineAdapter({
      adapter: FakeAdapter,
      context: FakeContext,
      step: TestStep,
      phase: TestPhase,
      pipeline: ['Before', 'Parse', 'After'],
    });

    // Assert
    expect(result.phase).toBe(TestPhase);
  });

  it('should omit phase when not provided', () => {
    // Arrange & Act
    const result = defineAdapter({
      adapter: FakeAdapter,
      context: FakeContext,
      step: TestStep,
      pipeline: [],
    });

    // Assert
    expect(result.phase).toBeUndefined();
  });

  it('should freeze the provides array', () => {
    // Arrange & Act
    const result = defineAdapter({
      adapter: FakeAdapter,
      context: FakeContext,
      step: TestStep,
      pipeline: [],
      provides: [bodyInput, paramsInput],
    });

    // Assert
    expect(Object.isFrozen(result.provides)).toBe(true);
    expect(result.provides).toEqual([bodyInput, paramsInput]);
  });

  it('should create a defensive copy of the provides array', () => {
    // Arrange
    const provides = [bodyInput];

    // Act
    const result = defineAdapter({
      adapter: FakeAdapter,
      context: FakeContext,
      step: TestStep,
      pipeline: [],
      provides,
    });
    provides.push(paramsInput);

    // Assert
    expect(result.provides).toHaveLength(1);
    expect(result.provides).toEqual([bodyInput]);
  });

  it('should omit provides when not provided', () => {
    // Arrange & Act
    const result = defineAdapter({
      adapter: FakeAdapter,
      context: FakeContext,
      step: TestStep,
      pipeline: [],
    });

    // Assert
    expect(result.provides).toBeUndefined();
  });
});
