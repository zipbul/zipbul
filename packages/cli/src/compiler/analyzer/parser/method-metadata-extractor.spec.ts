import { describe, expect, it } from 'bun:test';
import { isErr } from '@zipbul/result';
import { parseSource } from '@zipbul/gildash';
import type { Node } from '@zipbul/gildash';

import {
  extractExceptionFiltersFromConfigure,
  extractMiddlewaresFromConfigure,
  extractDependencies,
} from './method-metadata-extractor';

/**
 * Parses a class source string and returns the function-value node for the
 * first method definition in the class body.
 */
function parseMethodFunction(classSource: string): Node {
  const parsed = parseSource('test.ts', classSource);

  if (isErr(parsed)) {
    throw new Error(`Parse failure: ${JSON.stringify(parsed.data)}`);
  }

  const classNode = parsed.program.body[0] as unknown as { body: { body: Node[] } };
  const method = classNode.body.body[0];

  if (method === undefined || method.type !== 'MethodDefinition') {
    throw new Error(`Expected MethodDefinition, got ${method === undefined ? 'undefined' : method.type}`);
  }

  return (method as unknown as { value: Node }).value;
}

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

describe('extractExceptionFiltersFromConfigure', () => {
  describe('happy path', () => {
    it('should extract single exception filter from addErrorFilters call', () => {
      const funcNode = parseMethodFunction(
        'class Ctrl { configure() { this.addErrorFilters([GlobalFilter]); } }',
      );
      const result = extractExceptionFiltersFromConfigure(funcNode, 'test.ts');

      expect(isErr(result)).toBe(false);
      expect(result).toEqual([{ name: 'GlobalFilter', index: 0 }]);
    });

    it('should extract multiple exception filters preserving order', () => {
      const funcNode = parseMethodFunction(
        'class Ctrl { configure() { this.addErrorFilters([FilterA, FilterB, FilterC]); } }',
      );
      const result = extractExceptionFiltersFromConfigure(funcNode, 'test.ts');

      expect(isErr(result)).toBe(false);
      expect(result).toEqual([
        { name: 'FilterA', index: 0 },
        { name: 'FilterB', index: 1 },
        { name: 'FilterC', index: 2 },
      ]);
    });

    it('should return empty array when configure has no addErrorFilters call', () => {
      const funcNode = parseMethodFunction(
        'class Ctrl { configure() { this.addMiddlewares(lifecycle, [Mw]); } }',
      );
      const result = extractExceptionFiltersFromConfigure(funcNode, 'test.ts');

      expect(isErr(result)).toBe(false);
      expect(result).toEqual([]);
    });
  });

  describe('null body', () => {
    it('should return empty array when function body is null', () => {
      const funcNode = parseMethodFunction(
        'class Ctrl { configure() { this.addErrorFilters([A]); } }',
      );
      const mutable = funcNode as unknown as { body: unknown };
      const originalBody = mutable.body;

      mutable.body = null;

      const result = extractExceptionFiltersFromConfigure(funcNode, 'test.ts');

      expect(isErr(result)).toBe(false);
      expect(result).toEqual([]);

      mutable.body = originalBody;
    });
  });

  describe('empty array', () => {
    it('should return empty array when addErrorFilters receives an empty array', () => {
      const funcNode = parseMethodFunction(
        'class Ctrl { configure() { this.addErrorFilters([]); } }',
      );
      const result = extractExceptionFiltersFromConfigure(funcNode, 'test.ts');

      expect(isErr(result)).toBe(false);
      expect(result).toEqual([]);
    });
  });

  describe('error cases', () => {
    it('should return diagnostic error when argument is not an array', () => {
      const funcNode = parseMethodFunction(
        'class Ctrl { configure() { this.addErrorFilters(SomeFilter); } }',
      );
      const result = extractExceptionFiltersFromConfigure(funcNode, 'test.ts');

      expect(isErr(result)).toBe(true);

      if (isErr(result)) {
        expect(result.data.why).toMatch(/addErrorFilters/);
      }
    });

    it('should return diagnostic error when array contains a spread element', () => {
      const funcNode = parseMethodFunction(
        'class Ctrl { configure() { this.addErrorFilters([...filters]); } }',
      );
      const result = extractExceptionFiltersFromConfigure(funcNode, 'test.ts');

      expect(isErr(result)).toBe(true);

      if (isErr(result)) {
        expect(result.data.why).toMatch(/addErrorFilters/);
      }
    });

    it('should return diagnostic error when array element is a non-identifier expression', () => {
      const funcNode = parseMethodFunction(
        'class Ctrl { configure() { this.addErrorFilters([new Filter()]); } }',
      );
      const result = extractExceptionFiltersFromConfigure(funcNode, 'test.ts');

      expect(isErr(result)).toBe(true);

      if (isErr(result)) {
        expect(result.data.why).toMatch(/addErrorFilters/);
      }
    });

    it('should return diagnostic error when addErrorFilters has no arguments', () => {
      const funcNode = parseMethodFunction(
        'class Ctrl { configure() { this.addErrorFilters(); } }',
      );
      const result = extractExceptionFiltersFromConfigure(funcNode, 'test.ts');

      expect(isErr(result)).toBe(true);

      if (isErr(result)) {
        expect(result.data.why).toMatch(/addErrorFilters/);
      }
    });
  });
});

describe('extractMiddlewaresFromConfigure', () => {
  describe('happy path', () => {
    it('should extract single middleware with lifecycle', () => {
      const funcNode = parseMethodFunction(
        'class Ctrl { configure() { this.addMiddlewares(beforeHandle, [AuthMiddleware]); } }',
      );
      const result = extractMiddlewaresFromConfigure(funcNode, 'test.ts');

      expect(isErr(result)).toBe(false);
      expect(result).toEqual([
        { name: 'AuthMiddleware', lifecycle: 'beforeHandle', index: 0 },
      ]);
    });

    it('should extract multiple middlewares preserving order and index', () => {
      const funcNode = parseMethodFunction(
        'class Ctrl { configure() { this.addMiddlewares(beforeHandle, [MwA, MwB, MwC]); } }',
      );
      const result = extractMiddlewaresFromConfigure(funcNode, 'test.ts');

      expect(isErr(result)).toBe(false);
      expect(result).toEqual([
        { name: 'MwA', lifecycle: 'beforeHandle', index: 0 },
        { name: 'MwB', lifecycle: 'beforeHandle', index: 1 },
        { name: 'MwC', lifecycle: 'beforeHandle', index: 2 },
      ]);
    });

    it('should extract middleware with withOptions call pattern', () => {
      const funcNode = parseMethodFunction(
        'class Ctrl { configure() { this.addMiddlewares(beforeHandle, [LogMiddleware.withOptions({ level: "debug" })]); } }',
      );
      const result = extractMiddlewaresFromConfigure(funcNode, 'test.ts');

      expect(isErr(result)).toBe(false);
      expect(result).toEqual([
        { name: 'LogMiddleware', lifecycle: 'beforeHandle', index: 0 },
      ]);
    });

    it('should extract mixed identifier and withOptions middlewares', () => {
      const funcNode = parseMethodFunction(
        'class Ctrl { configure() { this.addMiddlewares(beforeHandle, [AuthMw, LogMw.withOptions({})]); } }',
      );
      const result = extractMiddlewaresFromConfigure(funcNode, 'test.ts');

      expect(isErr(result)).toBe(false);
      expect(result).toEqual([
        { name: 'AuthMw', lifecycle: 'beforeHandle', index: 0 },
        { name: 'LogMw', lifecycle: 'beforeHandle', index: 1 },
      ]);
    });

    it('should return empty array when configure has no addMiddlewares call', () => {
      const funcNode = parseMethodFunction(
        'class Ctrl { configure() { this.addErrorFilters([F]); } }',
      );
      const result = extractMiddlewaresFromConfigure(funcNode, 'test.ts');

      expect(isErr(result)).toBe(false);
      expect(result).toEqual([]);
    });
  });

  describe('lifecycle handling', () => {
    it('should omit lifecycle when first argument is not an identifier', () => {
      const funcNode = parseMethodFunction(
        'class Ctrl { configure() { this.addMiddlewares("beforeHandle", [AuthMw]); } }',
      );
      const result = extractMiddlewaresFromConfigure(funcNode, 'test.ts');

      expect(isErr(result)).toBe(false);

      if (!isErr(result) && result !== undefined) {
        expect(result).toHaveLength(1);
        expect(result[0]?.name).toBe('AuthMw');
        expect(result[0]?.lifecycle).toBeUndefined();
      }
    });

    it('should omit lifecycle for withOptions pattern when first arg is not identifier', () => {
      const funcNode = parseMethodFunction(
        'class Ctrl { configure() { this.addMiddlewares("phase", [LogMw.withOptions({})]); } }',
      );
      const result = extractMiddlewaresFromConfigure(funcNode, 'test.ts');

      expect(isErr(result)).toBe(false);

      if (!isErr(result) && result !== undefined) {
        expect(result).toHaveLength(1);
        expect(result[0]?.name).toBe('LogMw');
        expect(result[0]?.lifecycle).toBeUndefined();
      }
    });
  });

  describe('null body', () => {
    it('should return empty array when function body is null', () => {
      const funcNode = parseMethodFunction(
        'class Ctrl { configure() { this.addMiddlewares(lc, [A]); } }',
      );

      (funcNode as unknown as { body: unknown }).body = null;

      const result = extractMiddlewaresFromConfigure(funcNode, 'test.ts');

      expect(isErr(result)).toBe(false);
      expect(result).toEqual([]);
    });
  });

  describe('empty array', () => {
    it('should return empty array when addMiddlewares receives an empty array', () => {
      const funcNode = parseMethodFunction(
        'class Ctrl { configure() { this.addMiddlewares(beforeHandle, []); } }',
      );
      const result = extractMiddlewaresFromConfigure(funcNode, 'test.ts');

      expect(isErr(result)).toBe(false);
      expect(result).toEqual([]);
    });
  });

  describe('error cases', () => {
    it('should return diagnostic error when second argument is not an array', () => {
      const funcNode = parseMethodFunction(
        'class Ctrl { configure() { this.addMiddlewares(beforeHandle, SomeMw); } }',
      );
      const result = extractMiddlewaresFromConfigure(funcNode, 'test.ts');

      expect(isErr(result)).toBe(true);

      if (isErr(result)) {
        expect(result.data.why).toMatch(/addMiddlewares/);
      }
    });

    it('should return diagnostic error when array contains a spread element', () => {
      const funcNode = parseMethodFunction(
        'class Ctrl { configure() { this.addMiddlewares(beforeHandle, [...mws]); } }',
      );
      const result = extractMiddlewaresFromConfigure(funcNode, 'test.ts');

      expect(isErr(result)).toBe(true);

      if (isErr(result)) {
        expect(result.data.why).toMatch(/addMiddlewares/);
      }
    });

    it('should return diagnostic error when array element is a non-identifier non-withOptions expression', () => {
      const funcNode = parseMethodFunction(
        'class Ctrl { configure() { this.addMiddlewares(beforeHandle, [new Mw()]); } }',
      );
      const result = extractMiddlewaresFromConfigure(funcNode, 'test.ts');

      expect(isErr(result)).toBe(true);

      if (isErr(result)) {
        expect(result.data.why).toMatch(/addMiddlewares/);
      }
    });

    it('should return diagnostic error when addMiddlewares has only one argument that is not an array', () => {
      const funcNode = parseMethodFunction(
        'class Ctrl { configure() { this.addMiddlewares(beforeHandle); } }',
      );
      const result = extractMiddlewaresFromConfigure(funcNode, 'test.ts');

      expect(isErr(result)).toBe(true);

      if (isErr(result)) {
        expect(result.data.why).toMatch(/addMiddlewares/);
      }
    });

    it('should return diagnostic error for call expression element that is not withOptions', () => {
      const funcNode = parseMethodFunction(
        'class Ctrl { configure() { this.addMiddlewares(beforeHandle, [Mw.otherMethod()]); } }',
      );
      const result = extractMiddlewaresFromConfigure(funcNode, 'test.ts');

      expect(isErr(result)).toBe(true);

      if (isErr(result)) {
        expect(result.data.why).toMatch(/addMiddlewares/);
      }
    });
  });
});

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
