import { describe, it, expect, mock } from 'bun:test';

mock.module('@zipbul/core', () => ({
  ClusterManager: class {},
  getRuntimeContext: () => ({}),
}));

mock.module('@zipbul/baker', () => ({
  seal: () => {},
  deserialize: async () => ({}),
  BakerValidationError: class BakerValidationError extends Error {
    errors = [];
    constructor() { super('mock'); }
  },
}));

const { adapterDefinition } = await import('./adapter-definition');
const { HttpAdapter } = await import('./http-adapter');
const { RestController } = await import('./decorators/class.decorator');
const { Get, Post, Put, Delete, Patch, Options, Head } = await import('./decorators/method.decorator');

describe('adapterDefinition', () => {
  it('should export adapterDefinition as the HttpAdapter class itself', () => {
    // Arrange — adapterDefinition is module-level constant

    // Act & Assert
    expect(adapterDefinition).toBe(HttpAdapter);
  });

  it('should have instance name equal to http', () => {
    // Arrange
    const instance = new adapterDefinition();

    // Act & Assert
    expect(instance.name).toBe('http');
  });

  it('should set controller to RestController', () => {
    // Arrange
    const instance = new adapterDefinition();
    const { decorators } = instance;

    // Act & Assert
    expect(decorators.controller).toBe(RestController);
  });

  it('should set decorators.handler to exactly 7 HTTP method decorators', () => {
    // Arrange
    const instance = new adapterDefinition();
    const { decorators } = instance;
    const expectedHandlers = [Get, Post, Put, Delete, Patch, Options, Head];

    // Act & Assert
    expect(decorators.handler).toHaveLength(7);
    for (const expected of expectedHandlers) {
      expect(decorators.handler).toContain(expected);
    }
  });
});
