import { describe, expect, it } from 'bun:test';

import { synthesizeAdapterExtraction } from '../../src/compiler/adapter-build';
import type { ReadAdapterManifestResult } from '../../src/compiler/adapter-build';
import { DiagnosticError } from '../../src/diagnostics';

function buildResult(overrides: Partial<ReadAdapterManifestResult>): ReadAdapterManifestResult {
  return {
    packageName: '@example/x',
    adapter: { $schemaName: 'adapter.manifest', adapterId: 'X', manifests: {} },
    pipeline: null,
    decorators: { $schemaName: 'adapter.decorator-schema', controller: 'Ctrl', handlers: ['Get'], options: [] },
    peerContract: null,
    contextNamespaces: null,
    constructorSchema: null,
    builtins: null,
    ...overrides,
  };
}

describe('synthesizeAdapterExtraction — 영역 2 step 1b', () => {
  it('maps adapterId + entryDecorators (controller / handlers / options) from manifest', () => {
    const result = buildResult({
      decorators: { $schemaName: 'adapter.decorator-schema', controller: 'RestController', handlers: ['Get', 'Post'], options: ['Cached'] },
    });

    const extraction = synthesizeAdapterExtraction(result);

    expect(extraction.adapterId).toBe('X');
    expect(extraction.staticSchema.entryDecorators).toEqual({
      controller: 'RestController',
      handlers: ['Get', 'Post'],
      options: ['Cached'],
    });
  });

  it('throws when decorator-schema is absent (entryDecorators required)', () => {
    expect(() => synthesizeAdapterExtraction(buildResult({ decorators: null })))
      .toThrow(DiagnosticError);
  });

  it('maps pipeline.pipeline → string[] of unqualified member names', () => {
    const extraction = synthesizeAdapterExtraction(buildResult({
      pipeline: {
        $schemaName: 'adapter.pipeline-schema',
        phaseEnum: 'TestPhase',
        stepEnum: 'TestStep',
        phaseMembers: ['OnRequest', 'AfterResponse'],
        stepMembers: ['ResolveRoute'],
        pipeline: [
          { qualifier: 'TestPhase', name: 'OnRequest' },
          { qualifier: 'CoreStep', name: 'Handler' },
        ],
      },
    }));

    expect(extraction.staticSchema.pipeline).toEqual(['OnRequest', 'Handler']);
  });

  it('maps phaseMembers → validPhases as a Set', () => {
    const extraction = synthesizeAdapterExtraction(buildResult({
      pipeline: {
        $schemaName: 'adapter.pipeline-schema',
        phaseEnum: 'TestPhase',
        stepEnum: 'TestStep',
        phaseMembers: ['OnRequest', 'AfterResponse'],
        stepMembers: [],
        pipeline: [],
      },
    }));

    expect(extraction.staticSchema.validPhases).toEqual(new Set(['OnRequest', 'AfterResponse']));
  });

  it('omits validPhases / pipeline when pipeline manifest is null', () => {
    const extraction = synthesizeAdapterExtraction(buildResult({ pipeline: null }));

    expect(extraction.staticSchema.validPhases).toBeUndefined();
    expect(extraction.staticSchema.pipeline).toBeUndefined();
  });

  it('maps contextNamespaces using packageName as the module specifier (E5)', () => {
    const extraction = synthesizeAdapterExtraction(buildResult({
      packageName: '@zipbul/http-adapter',
      contextNamespaces: {
        $schemaName: 'adapter.context-namespaces',
        contextType: 'HttpContext',
        methods: [],
        namespaces: [
          { name: 'request', type: 'HttpRequest' },
          { name: 'response', type: 'HttpResponse' },
          { name: 'malformed', type: null },
        ],
      },
    }));

    expect(extraction.staticSchema.contextNamespaces).toEqual({
      contextType: 'HttpContext',
      module: '@zipbul/http-adapter',
      namespaces: { request: 'HttpRequest', response: 'HttpResponse' },
    });
  });

  it('omits contextNamespaces when manifest is null', () => {
    const extraction = synthesizeAdapterExtraction(buildResult({ contextNamespaces: null }));

    expect(extraction.staticSchema.contextNamespaces).toBeUndefined();
  });
});
