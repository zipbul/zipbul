import { describe, expect, it } from 'bun:test';

import type { ModuleGraph } from '../analyzer';
import type { HandlerIndexEntry } from '../analyzer/interfaces';
import type { MetadataClassEntry } from './interfaces';

import { selectRegistryClasses } from './registry-class-selector';

const cls = (className: string): MetadataClassEntry => ({
  filePath: `/app/${className}.ts`,
  metadata: { className, decorators: [], methods: [], properties: [], imports: {} },
});

const graphWith = (...controllers: string[]): ModuleGraph =>
  ({ modules: new Map([['m', { controllers: new Set(controllers) }]]) } as unknown as ModuleGraph);

const handler = (...metatypeKeys: string[]): HandlerIndexEntry =>
  ({ validations: metatypeKeys.map(k => ({ accessor: ['request', 'getBody'], metatypeKey: k })) } as unknown as HandlerIndexEntry);

describe('selectRegistryClasses', () => {
  it('should include controller classes', () => {
    const result = selectRegistryClasses([cls('FooController'), cls('AuditService')], graphWith('FooController'), []);

    expect(result.map(c => c.metadata.className)).toEqual(['FooController']);
  });

  it('should include handler validation DTO classes', () => {
    const result = selectRegistryClasses([cls('ChargeDto'), cls('AuditService')], graphWith(), [handler('ChargeDto')]);

    expect(result.map(c => c.metadata.className)).toEqual(['ChargeDto']);
  });

  it('should include both controllers and DTOs (union)', () => {
    const result = selectRegistryClasses(
      [cls('FooController'), cls('ChargeDto'), cls('AuditService')],
      graphWith('FooController'),
      [handler('ChargeDto')],
    );

    expect(result.map(c => c.metadata.className).sort()).toEqual(['ChargeDto', 'FooController']);
  });

  it('should exclude providers and handler-unreferenced classes (e.g. CorsOptions)', () => {
    const result = selectRegistryClasses([cls('CorsOptions'), cls('AuditService')], graphWith('FooController'), [handler('ChargeDto')]);

    expect(result).toEqual([]);
  });

  it('should include a DTO referenced by getParams as well as getBody', () => {
    const entry = { validations: [{ accessor: ['request', 'getParams'], metatypeKey: 'IdRouteParams' }] } as unknown as HandlerIndexEntry;
    const result = selectRegistryClasses([cls('IdRouteParams')], graphWith(), [entry]);

    expect(result.map(c => c.metadata.className)).toEqual(['IdRouteParams']);
  });

  it('should handle handler entries without validations', () => {
    const result = selectRegistryClasses([cls('FooController')], graphWith('FooController'), [{} as unknown as HandlerIndexEntry]);

    expect(result.map(c => c.metadata.className)).toEqual(['FooController']);
  });

  it('should skip validations with undefined metatypeKey', () => {
    const entry = { validations: [{ accessor: ['request', 'getBody'] }] } as unknown as HandlerIndexEntry;
    const result = selectRegistryClasses([cls('Dto')], graphWith(), [entry]);

    expect(result).toEqual([]);
  });
});
