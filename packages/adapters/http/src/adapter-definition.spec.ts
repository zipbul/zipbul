import { describe, it, expect, mock } from 'bun:test';

const actualCore = await import('@zipbul/core');
mock.module('@zipbul/core', () => ({
  ...actualCore,
  getBootstrapState: () => ({ isAotRuntime: false, metadataRegistry: new Map() }),
}));

mock.module('@zipbul/baker', () => ({
  deserialize: async () => ({}),
  isBakerError: () => false,
}));

const { adapterDefinition } = await import('./adapter-definition');
const { HttpAdapter } = await import('./http-adapter');
const { HttpContext } = await import('./http-context');
const { HttpAdapterStep, HttpAdapterPhase } = await import('./enums');

describe('adapterDefinition', () => {
  it('should be a frozen config object', () => {
    expect(Object.isFrozen(adapterDefinition)).toBe(true);
  });

  it('should reference HttpAdapter as the adapter class', () => {
    expect(adapterDefinition.adapter).toBe(HttpAdapter);
  });

  it('should reference HttpContext as the context class', () => {
    expect(adapterDefinition.context).toBe(HttpContext);
  });

  it('should use HttpAdapterStep as step enum', () => {
    expect(adapterDefinition.step).toBe(HttpAdapterStep);
  });

  it('should use HttpAdapterPhase as phase enum', () => {
    expect(adapterDefinition.phase).toBe(HttpAdapterPhase);
  });

  it('should declare a pipeline containing all 3 CoreSteps', () => {
    expect(adapterDefinition.pipeline).toContain('Handler');
    expect(adapterDefinition.pipeline).toContain('Guard');
    expect(adapterDefinition.pipeline).toContain('Validation');
  });

  it('should declare a pipeline with Handler after Guard and Validation', () => {
    const pipeline = adapterDefinition.pipeline;
    const handlerIdx = pipeline.indexOf('Handler');
    const guardIdx = pipeline.indexOf('Guard');
    const validationIdx = pipeline.indexOf('Validation');

    expect(guardIdx).toBeLessThan(handlerIdx);
    expect(validationIdx).toBeLessThan(handlerIdx);
  });

  it('should include all HttpAdapterStep values in the pipeline', () => {
    const pipeline = adapterDefinition.pipeline;

    for (const step of Object.values(HttpAdapterStep)) {
      expect(pipeline).toContain(step);
    }
  });

  it('should include all HttpAdapterPhase values in the pipeline', () => {
    const pipeline = adapterDefinition.pipeline;

    for (const phase of Object.values(HttpAdapterPhase)) {
      expect(pipeline).toContain(phase);
    }
  });

  it('should have a frozen pipeline array', () => {
    expect(Object.isFrozen(adapterDefinition.pipeline)).toBe(true);
  });
});
