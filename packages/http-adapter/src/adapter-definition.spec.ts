import { describe, it, expect, mock } from 'bun:test';
import { ReservedPipeline } from '@zipbul/common';

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

const { adapterSpec } = await import('./adapter-definition');
const { ZipbulHttpAdapter } = await import('./zipbul-http-adapter');
const { RestController } = await import('./decorators/class.decorator');
const { Get, Post, Put, Delete, Patch, Options, Head } = await import('./decorators/method.decorator');
const { HttpMiddlewarePhase } = await import('./enums');

describe('adapterSpec', () => {
  it('should export adapterSpec as the ZipbulHttpAdapter class itself', () => {
    // Arrange — adapterSpec is module-level constant

    // Act & Assert
    expect(adapterSpec).toBe(ZipbulHttpAdapter);
  });

  it('should have instance name equal to http', () => {
    // Arrange
    const instance = new adapterSpec();

    // Act & Assert
    expect(instance.name).toBe('http');
  });

  it('should have instance pipeline equal to [BeforeRequest, Guards, Handler, AfterRequest] in order', () => {
    // Arrange
    const instance = new adapterSpec();
    const { pipeline } = instance;

    // Act & Assert
    expect(pipeline).toHaveLength(4);
    expect(pipeline).toEqual([
      HttpMiddlewarePhase.BeforeRequest,
      ReservedPipeline.Guards,
      ReservedPipeline.Handler,
      HttpMiddlewarePhase.AfterRequest,
    ]);
  });

  it('should contain Guards, Handler each exactly once in pipeline (R-004)', () => {
    // Arrange
    const instance = new adapterSpec();
    const { pipeline } = instance;

    // Act
    const guardsCount = pipeline.filter((t) => t === ReservedPipeline.Guards).length;
    const handlerCount = pipeline.filter((t) => t === ReservedPipeline.Handler).length;

    // Assert
    expect(guardsCount).toBe(1);
    expect(handlerCount).toBe(1);
  });

  it('should set controller to RestController', () => {
    // Arrange
    const instance = new adapterSpec();
    const { decorators } = instance;

    // Act & Assert
    expect(decorators.controller).toBe(RestController);
  });

  it('should set decorators.handler to exactly 7 HTTP method decorators', () => {
    // Arrange
    const instance = new adapterSpec();
    const { decorators } = instance;
    const expectedHandlers = [Get, Post, Put, Delete, Patch, Options, Head];

    // Act & Assert
    expect(decorators.handler).toHaveLength(7);
    for (const expected of expectedHandlers) {
      expect(decorators.handler).toContain(expected);
    }
  });
});
