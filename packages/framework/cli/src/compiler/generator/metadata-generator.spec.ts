/**
 * Unit spec for {@link MetadataGenerator}.
 *
 * The metadata registry is a `className → constructor` lookup for the router
 * (controllers for the `@Controller` prefix; handler DTOs to hand to baker).
 * Only `className` + class-level `decorators` are emitted. Property/method
 * metadata and `@Field` baker rules are NOT emitted — baker owns DTO schemas via
 * `Class[Symbol.metadata]`, so the compiler must not serialize rule expressions.
 */
import { describe, expect, it } from 'bun:test';

import type { AnalyzerValue } from '../analyzer/types';
import type { DecoratorMetadata } from '../analyzer/interfaces';
import type { MetadataClassEntry } from './interfaces';

import { ImportRegistry } from './import-registry';
import { MetadataGenerator } from './metadata-generator';

const decorator = (name: string, args: AnalyzerValue[] = []): DecoratorMetadata => ({ name, arguments: args });

const entry = (className: string, decorators: DecoratorMetadata[] = [], filePath = '/app/x.ts'): MetadataClassEntry => ({
  filePath,
  metadata: { className, decorators, methods: [], properties: [], imports: {} },
});

const generate = (classes: MetadataClassEntry[]): { code: string; imports: string } => {
  const registry = new ImportRegistry('/out');
  const code = new MetadataGenerator().generate(classes, registry);

  return { code, imports: registry.getImportStatements().join('\n') };
};

describe('MetadataGenerator', () => {
  it('should emit registry.set with a _meta(className, decorators) call', () => {
    const { code } = generate([entry('UsersController', [decorator('Controller', ['users'])])]);

    expect(code).toContain('_meta(');
    expect(code).toContain("'UsersController'");
  });

  it('should serialize the class decorator name and arguments (e.g. @Controller prefix)', () => {
    const { code } = generate([entry('UsersController', [decorator('Controller', ['users'])])]);

    expect(code).toContain('"Controller"');
    expect(code).toContain('"users"');
  });

  it('should not emit property metadata (baker owns @Field schema via Symbol.metadata)', () => {
    const { code } = generate([entry('ChargeDto', [decorator('Recipe')])]);

    expect(code).not.toContain('properties');
  });

  it('should not emit method metadata', () => {
    const { code } = generate([entry('UsersController', [decorator('Controller')])]);

    expect(code).not.toContain('parameters:');
  });

  it('should not emit a constructorParams field', () => {
    const { code } = generate([entry('ChargeDto', [decorator('Recipe')])]);

    expect(code).not.toContain('constructorParams');
  });

  it('should emit classes sorted by className', () => {
    const { code } = generate([entry('Beta'), entry('Alpha')]);

    expect(code.indexOf("'Alpha'")).toBeLessThan(code.indexOf("'Beta'"));
  });
});
