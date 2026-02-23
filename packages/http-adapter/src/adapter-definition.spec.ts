import { describe, it, expect, mock } from 'bun:test';

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

describe('adapterSpec', () => {
  it('should export adapterSpec with name http and classRef ZipbulHttpAdapter', () => {
    // Arrange — adapterSpec is module-level constant

    // Act
    const { name, classRef } = adapterSpec;

    // Assert
    expect(name).toBe('http');
    expect(classRef).toBe(ZipbulHttpAdapter);
  });

  it('should define pipeline with Handler exactly once and Guards/Pipes at most once (R-004)', () => {
    // Arrange
    const { pipeline } = adapterSpec;

    // Act
    const handlerCount = pipeline.filter((t) => t === 'Handler').length;
    const guardsCount = pipeline.filter((t) => t === 'Guards').length;
    const pipesCount = pipeline.filter((t) => t === 'Pipes').length;

    // Assert
    expect(handlerCount).toBe(1);
    expect(guardsCount).toBeLessThanOrEqual(1);
    expect(pipesCount).toBeLessThanOrEqual(1);
  });

  it('should preserve middlewarePhaseOrder relative order in pipeline and include all phases (R-006, R-007)', () => {
    // Arrange
    const { pipeline, middlewarePhaseOrder } = adapterSpec;
    const reservedTokens = new Set(['Guards', 'Pipes', 'Handler']);

    // Act — extract phase ids from pipeline in order
    const pipelinePhases = pipeline.filter((t) => !reservedTokens.has(t));

    // Assert — every phase in middlewarePhaseOrder appears exactly once in pipeline phases
    expect(pipelinePhases).toEqual(middlewarePhaseOrder);
  });

  it('should set controller to RestController and handler to all 7 HTTP method decorators', () => {
    // Arrange
    const { decorators } = adapterSpec;
    const expectedHandlers = [Get, Post, Put, Delete, Patch, Options, Head];

    // Act & Assert
    expect(decorators.controller).toBe(RestController);
    expect(decorators.handler).toHaveLength(7);
    for (const expected of expectedHandlers) {
      expect(decorators.handler).toContain(expected);
    }
  });

  it('should have supportedMiddlewarePhases keys equal to middlewarePhaseOrder set (R-006)', () => {
    // Arrange
    const { middlewarePhaseOrder, supportedMiddlewarePhases } = adapterSpec;

    // Act
    const supportedKeys = Object.keys(supportedMiddlewarePhases).sort();
    const phaseOrderSorted = [...middlewarePhaseOrder].sort();

    // Assert
    expect(supportedKeys).toEqual(phaseOrderSorted);
    // All values must be true
    for (const key of supportedKeys) {
      expect(supportedMiddlewarePhases[key]).toBe(true);
    }
  });
});
