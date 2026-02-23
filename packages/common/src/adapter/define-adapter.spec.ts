import { describe, it, expect } from 'bun:test';
import { defineAdapter } from './define-adapter';
import type { AdapterRegistrationInput } from './types';

// -- Test fixtures --

class FakeAdapter {
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}

const controllerDeco = () => {};
const getDeco = () => {};
const postDeco = () => {};

function createValidInput(overrides?: Partial<AdapterRegistrationInput>): AdapterRegistrationInput {
  return {
    name: 'http',
    classRef: FakeAdapter as any,
    pipeline: ['BeforeRequest', 'Guards', 'Pipes', 'Handler', 'AfterRequest'],
    middlewarePhaseOrder: ['BeforeRequest', 'AfterRequest'],
    supportedMiddlewarePhases: { BeforeRequest: true, AfterRequest: true },
    decorators: {
      controller: controllerDeco,
      handler: [getDeco, postDeco],
    },
    ...overrides,
  };
}

describe('defineAdapter', () => {
  it('should return the input with all required fields when given a valid AdapterRegistrationInput', () => {
    // Arrange
    const input = createValidInput();

    // Act
    const result = defineAdapter(input);

    // Assert
    expect(result.name).toBe('http');
    expect(result.classRef).toBe(FakeAdapter);
    expect(result.pipeline).toEqual(['BeforeRequest', 'Guards', 'Pipes', 'Handler', 'AfterRequest']);
    expect(result.middlewarePhaseOrder).toEqual(['BeforeRequest', 'AfterRequest']);
    expect(result.supportedMiddlewarePhases).toEqual({ BeforeRequest: true, AfterRequest: true });
    expect(result.decorators.controller).toBe(controllerDeco);
    expect(result.decorators.handler).toEqual([getDeco, postDeco]);
  });

  it('should return the exact same reference (===) when called with any input', () => {
    // Arrange
    const input = createValidInput();

    // Act
    const result = defineAdapter(input);

    // Assert
    expect(result).toBe(input);
  });

  it('should return identical results when called multiple times with the same input', () => {
    // Arrange
    const input = createValidInput();

    // Act
    const result1 = defineAdapter(input);
    const result2 = defineAdapter(input);

    // Assert
    expect(result1).toBe(result2);
    expect(result1).toBe(input);
  });

  it('should return the input unchanged when middlewarePhaseOrder and handler array are empty', () => {
    // Arrange
    const input = createValidInput({
      pipeline: ['Handler'],
      middlewarePhaseOrder: [],
      supportedMiddlewarePhases: {},
      decorators: { controller: controllerDeco, handler: [] },
    });

    // Act
    const result = defineAdapter(input);

    // Assert
    expect(result).toBe(input);
    expect(result.middlewarePhaseOrder).toEqual([]);
    expect(result.decorators.handler).toEqual([]);
  });

  it('should preserve all nested properties of decorators when present', () => {
    // Arrange
    const handler1 = () => {};
    const handler2 = () => {};
    const handler3 = () => {};
    const ctrl = () => {};
    const input = createValidInput({
      decorators: { controller: ctrl, handler: [handler1, handler2, handler3] },
    });

    // Act
    const result = defineAdapter(input);

    // Assert
    expect(result.decorators.controller).toBe(ctrl);
    expect(result.decorators.handler).toHaveLength(3);
    expect(result.decorators.handler[0]).toBe(handler1);
    expect(result.decorators.handler[1]).toBe(handler2);
    expect(result.decorators.handler[2]).toBe(handler3);
  });
});
