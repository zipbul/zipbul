import { describe, it, expect, mock } from 'bun:test';

const actualCore = await import('@zipbul/core');
mock.module('@zipbul/core', () => ({
  ...actualCore,
  getRuntimeContext: () => ({ isAotRuntime: false, metadataRegistry: new Map() }),
}));

mock.module('@zipbul/baker', () => ({
  deserialize: async () => ({}),
  isBakerError: () => false,
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
    expect(decorators.handlers).toHaveLength(7);
    for (const expected of expectedHandlers) {
      expect(decorators.handlers).toContain(expected);
    }
  });
});
