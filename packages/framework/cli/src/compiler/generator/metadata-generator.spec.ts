/**
 * Unit spec for {@link MetadataGenerator} — focuses on baker `@Field` rule
 * serialization in the emitted `createMetadataRegistry()`.
 *
 * baker rules appear as decorator arguments: bare rule identifiers
 * (`@Field(isBoolean)`) and call rules (`@Field(oneOf(isBoolean, ...))`). Both
 * are runtime VALUES and must be emitted as imported identifiers, never string
 * literals — otherwise baker rejects them at runtime ("oneOf: every argument
 * must be a baker rule"). Property TYPES, by contrast, must stay string
 * literals when they are not runtime classes (interfaces/type aliases do not
 * exist at runtime), so the two contexts must be serialized differently.
 */
import { ZIPBUL_CALL, ZIPBUL_IMPORT_SOURCE, ZIPBUL_REF } from '@zipbul/common';
import { describe, expect, it } from 'bun:test';

import type { AnalyzerValue } from '../analyzer/types';
import type { DecoratorMetadata, PropertyMetadata } from '../analyzer/interfaces';
import type { MetadataClassEntry } from './interfaces';

import { ImportRegistry } from './import-registry';
import { MetadataGenerator } from './metadata-generator';

const RULES = '@zipbul/baker/rules';

const ruleRef = (name: string): AnalyzerValue => ({ [ZIPBUL_REF]: name, [ZIPBUL_IMPORT_SOURCE]: RULES });
const ruleCall = (callee: string, args: AnalyzerValue[]): AnalyzerValue =>
  ({ [ZIPBUL_CALL]: callee, [ZIPBUL_IMPORT_SOURCE]: RULES, args });
const typeRef = (name: string, source: string): AnalyzerValue => ({ [ZIPBUL_REF]: name, [ZIPBUL_IMPORT_SOURCE]: source });

const field = (args: AnalyzerValue[]): DecoratorMetadata => ({ name: 'Field', arguments: args });
const prop = (name: string, decorators: DecoratorMetadata[], type: AnalyzerValue = 'boolean'): PropertyMetadata =>
  ({ name, type, decorators });

const entry = (className: string, properties: PropertyMetadata[], filePath = '/app/options.ts'): MetadataClassEntry => ({
  filePath,
  metadata: { className, decorators: [], methods: [], properties, imports: {} },
});

const generate = (classes: MetadataClassEntry[]): { code: string; imports: string } => {
  const registry = new ImportRegistry('/out');
  const code = new MetadataGenerator().generate(classes, registry);

  return { code, imports: registry.getImportStatements().join('\n') };
};

describe('MetadataGenerator — baker @Field rule serialization', () => {
  it('should emit a bare rule identifier as an imported value, not a string literal', () => {
    const { code, imports } = generate([entry('CorsOptions', [prop('credentials', [field([ruleRef('isBoolean')])])])]);

    expect(code).not.toContain('"isBoolean"');
    expect(imports).toContain('isBoolean');
  });

  it('should register the rule import from its module', () => {
    const registry = new ImportRegistry('/out');

    new MetadataGenerator().generate([entry('CorsOptions', [prop('credentials', [field([ruleRef('isBoolean')])])])], registry);

    expect(registry.getImportStatements().some(s => s.includes('isBoolean') && s.includes(RULES))).toBe(true);
  });

  it('should emit nested rule args inside a call rule as identifiers', () => {
    const { code } = generate([
      entry('CorsOptions', [prop('origin', [field([ruleCall('oneOf', [ruleRef('isBoolean'), ruleRef('isFunction')])])])]),
    ]);

    expect(code).toContain('oneOf(isBoolean, isFunction)');
    expect(code).not.toContain('"isBoolean"');
    expect(code).not.toContain('"isFunction"');
  });

  it('should keep a non-class type reference (interface) as a string literal', () => {
    const { code, imports } = generate([entry('Dto', [prop('shape', [], typeRef('SomeInterface', './types'))])]);

    expect(code).toContain('"SomeInterface"');
    expect(imports).not.toContain('SomeInterface');
  });

  it('should emit a known class type reference as an imported identifier', () => {
    const { code } = generate([
      entry('Dto', [prop('nested', [], typeRef('NestedDto', './nested'))]),
      entry('NestedDto', [], '/app/nested.ts'),
    ]);

    expect(code).toMatch(/\bNestedDto\b/);
  });
});
