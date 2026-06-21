import { describe, expect, it } from 'bun:test';
import { isErr } from '@zipbul/result';
import { parseSource } from '@zipbul/gildash';
import type { Node } from '@zipbul/gildash';

import { extractDependencies } from './method-metadata-extractor';

/**
 * Parses an expression source and returns the initializer node for the first
 * variable declarator.
 */
function parseExpression(source: string): Node {
  const parsed = parseSource('test.ts', source);

  if (isErr(parsed)) {
    throw new Error(`Parse failure: ${JSON.stringify(parsed.data)}`);
  }

  const stmt = parsed.program.body[0];

  if (stmt === undefined || stmt.type !== 'VariableDeclaration') {
    throw new Error(`Expected VariableDeclaration, got ${stmt === undefined ? 'undefined' : stmt.type}`);
  }

  const init = stmt.declarations[0]?.init as Node | null | undefined;

  if (init === null || init === undefined) {
    throw new Error('No initializer on variable declaration');
  }

  return init;
}

describe('extractDependencies', () => {
  describe('happy path', () => {
    it('should extract dependencies from arrow function body', () => {
      const expression = parseExpression(
        'const fn = (config) => new Foo(MyService);',
      );
      const imports: Record<string, string> = { MyService: './my-service' };
      const originalNames: Record<string, string> = {};
      const result = extractDependencies(expression, 0, imports, originalNames);

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('MyService');
      expect(result[0]?.path).toBe('./my-service');
    });

    it('should extract multiple dependencies', () => {
      const expression = parseExpression(
        'const fn = () => new Foo(ServiceA, ServiceB);',
      );
      const imports: Record<string, string> = {
        ServiceA: './service-a',
        ServiceB: './service-b',
      };
      const result = extractDependencies(expression, 0, imports, {});

      expect(result).toHaveLength(2);
      expect(result[0]?.name).toBe('ServiceA');
      expect(result[0]?.path).toBe('./service-a');
      expect(result[1]?.name).toBe('ServiceB');
      expect(result[1]?.path).toBe('./service-b');
    });

    it('should resolve aliased names to original export names', () => {
      const expression = parseExpression(
        'const fn = () => new Foo(Svc);',
      );
      const imports: Record<string, string> = { Svc: './service' };
      const originalNames: Record<string, string> = { Svc: 'MyService' };
      const result = extractDependencies(expression, 0, imports, originalNames);

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('MyService');
      expect(result[0]?.path).toBe('./service');
    });

    it('should apply offset to start and end positions', () => {
      const source = 'const fn = () => Dep;';
      const expression = parseExpression(source);
      const imports: Record<string, string> = { Dep: './dep' };
      const offset = 10;
      const result = extractDependencies(expression, offset, imports, {});

      expect(result).toHaveLength(1);
      expect(result[0]?.start).toBeLessThan(result[0]?.end ?? 0);
    });
  });

  describe('parameter exclusion', () => {
    it('should exclude nested function expression parameter names from dependencies', () => {
      const source = [
        'const fn = () => { return function(config) { return new Foo(config, External); }; };',
      ].join('');
      const expression = parseExpression(source);
      const imports: Record<string, string> = {
        config: './config-service',
        External: './external',
      };
      const result = extractDependencies(expression, 0, imports, {});
      const names = result.map(dep => dep.name);

      expect(names).toContain('External');
      expect(names).not.toContain('config');
    });

    it('should not exclude outer function expression parameters (only nested are tracked)', () => {
      const source = [
        'const fn = function(config) { return new Foo(config, External); };',
      ].join('');
      const expression = parseExpression(source);
      const imports: Record<string, string> = {
        config: './config-service',
        External: './external',
      };
      const result = extractDependencies(expression, 0, imports, {});
      const names = result.map(dep => dep.name);

      expect(names).toContain('External');
      expect(names).toContain('config');
    });
  });

  describe('empty and edge cases', () => {
    it('should return empty array when no identifiers match imports', () => {
      const expression = parseExpression(
        'const fn = () => new Foo(localVar);',
      );
      const result = extractDependencies(expression, 0, {}, {});

      expect(result).toHaveLength(0);
    });

    it('should return empty array for arrow function with empty body expression', () => {
      const expression = parseExpression(
        'const fn = () => 42;',
      );
      const result = extractDependencies(expression, 0, {}, {});

      expect(result).toHaveLength(0);
    });

    it('should handle non-function expression by visiting the node directly', () => {
      const expression = parseExpression(
        'const fn = MyService;',
      );
      const imports: Record<string, string> = { MyService: './my-service' };
      const result = extractDependencies(expression, 0, imports, {});

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('MyService');
    });

    it('should use local name as original when no alias mapping exists', () => {
      const expression = parseExpression(
        'const fn = () => Svc;',
      );
      const imports: Record<string, string> = { Svc: './svc' };
      const result = extractDependencies(expression, 0, imports, {});

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('Svc');
    });
  });

  describe('function expression body', () => {
    it('should extract dependencies from function expression body', () => {
      const expression = parseExpression(
        'const fn = function() { return new Foo(DepService); };',
      );
      const imports: Record<string, string> = { DepService: './dep-service' };
      const result = extractDependencies(expression, 0, imports, {});

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('DepService');
      expect(result[0]?.path).toBe('./dep-service');
    });

    it('should exclude nested function expression params while keeping outer params', () => {
      const expression = parseExpression(
        'const fn = function(outer) { return function(deep) { return new Foo(outer, deep, External); }; };',
      );
      const imports: Record<string, string> = {
        outer: './outer',
        deep: './deep',
        External: './external',
      };
      const result = extractDependencies(expression, 0, imports, {});
      const names = result.map(dep => dep.name);

      expect(names).toContain('External');
      expect(names).toContain('outer');
      expect(names).not.toContain('deep');
    });
  });

  describe('arrow function with block body', () => {
    it('should extract dependencies from arrow function with block body', () => {
      const expression = parseExpression(
        'const fn = () => { const result = new Foo(DepA); return result; };',
      );
      const imports: Record<string, string> = { DepA: './dep-a' };
      const result = extractDependencies(expression, 0, imports, {});

      expect(result).toHaveLength(1);
      expect(result[0]?.name).toBe('DepA');
    });
  });
});
