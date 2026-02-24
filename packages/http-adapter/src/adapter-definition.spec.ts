import { describe, it, expect, mock } from 'bun:test';
import { ReservedPipeline } from '@zipbul/common';

// Mock @zipbul/core before any transitive import pulls it in.
// The http-adapter import chain (ZipbulHttpAdapter → ZipbulHttpServer → RouteHandler
// → ValidationPipe) requires TransformerCompiler/ValidatorCompiler from core,
// which are not exported in the current dev state.
mock.module('@zipbul/core', () => ({
  ClusterManager: class {},
  getRuntimeContext: () => ({}),
  TransformerCompiler: { compilePlainToInstance: () => () => ({}) },
  ValidatorCompiler: { compile: () => () => [] },
}));

const { adapterSpec } = await import('./adapter-definition');
const { ZipbulHttpAdapter } = await import('./zipbul-http-adapter');
const { RestController } = await import('./decorators/class.decorator');
const { Get, Post, Put, Delete, Patch, Options, Head } = await import('./decorators/method.decorator');
const { HttpMiddlewarePhase } = await import('./enums');

describe('adapterSpec', () => {
  it('should export adapterSpec with name http and classRef ZipbulHttpAdapter', () => {
    // Arrange — adapterSpec is module-level constant

    // Act
    const { name, classRef } = adapterSpec;

    // Assert
    expect(name).toBe('http');
    expect(classRef).toBe(ZipbulHttpAdapter);
  });

  it('should have pipeline equal to [BeforeRequest, Guards, Pipes, Handler, AfterRequest] in order', () => {
    // Arrange
    const { pipeline } = adapterSpec;

    // Act & Assert
    expect(pipeline).toHaveLength(5);
    expect(pipeline).toEqual([
      HttpMiddlewarePhase.BeforeRequest,
      ReservedPipeline.Guards,
      ReservedPipeline.Pipes,
      ReservedPipeline.Handler,
      HttpMiddlewarePhase.AfterRequest,
    ]);
  });

  it('should contain Guards, Pipes, Handler each exactly once in pipeline (R-004)', () => {
    // Arrange
    const { pipeline } = adapterSpec;

    // Act
    const guardsCount = pipeline.filter((t) => t === ReservedPipeline.Guards).length;
    const pipesCount = pipeline.filter((t) => t === ReservedPipeline.Pipes).length;
    const handlerCount = pipeline.filter((t) => t === ReservedPipeline.Handler).length;

    // Assert
    expect(guardsCount).toBe(1);
    expect(pipesCount).toBe(1);
    expect(handlerCount).toBe(1);
  });

  it('should set controller to RestController', () => {
    // Arrange
    const { decorators } = adapterSpec;

    // Act & Assert
    expect(decorators.controller).toBe(RestController);
  });

  it('should set decorators.handler to exactly 7 HTTP method decorators', () => {
    // Arrange
    const { decorators } = adapterSpec;
    const expectedHandlers = [Get, Post, Put, Delete, Patch, Options, Head];

    // Act & Assert
    expect(decorators.handler).toHaveLength(7);
    for (const expected of expectedHandlers) {
      expect(decorators.handler).toContain(expected);
    }
  });
});
