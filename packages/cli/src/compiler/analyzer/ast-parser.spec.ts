import { describe, expect, it } from 'bun:test';
import { isErr } from '@zipbul/result';
import { ZIPBUL_UNRESOLVABLE } from '@zipbul/common';

import type { ParseResult } from './parser-models';
import type { AnalyzerValueRecord } from './types';

// MUST: MUST-1 (createApplication identification)

import { AstParser } from './ast-parser';

function parseOrFail(parser: AstParser, filename: string, code: string): ParseResult {
  const result = parser.parse(filename, code);

  if (isErr(result)) {
    throw new Error(`Unexpected parse failure: ${result.data.why}`);
  }

  return result;
}

describe('AstParser', () => {
  it('should collect createApplication calls when createApplication is imported from @zipbul/core', () => {
    const source = [
      "import { createApplication as ca } from '@zipbul/core';",
      "import * as zipbul from '@zipbul/core';",
      "import { createApplication } from 'other';",
      "import { AppModule } from './app.module';",
      '',
      'ca(AppModule);',
      'zipbul.createApplication(AppModule);',
      'createApplication(AppModule);',
    ].join('\n');
    const parser = new AstParser();
    const result = parseOrFail(parser, '/app/src/main.ts', source);
    const calls = result.createApplicationCalls ?? [];

    expect(calls.map(call => call.callee)).toEqual(['ca', 'zipbul.createApplication']);
    expect(calls.every(call => call.importSource === '@zipbul/core')).toBe(true);
  });

  it('should collect createApplication calls when createApplication is called in variable initializers', () => {
    const source = [
      "import { createApplication } from '@zipbul/core';",
      "import { createApplication as alias } from '@zipbul/core';",
      "import { AppModule } from './app.module';",
      '',
      'const app = createApplication(AppModule);',
      'export const exportedApp = alias(AppModule);',
    ].join('\n');
    const parser = new AstParser();
    const result = parseOrFail(parser, '/app/src/main.ts', source);
    const calls = result.createApplicationCalls ?? [];

    expect(calls.map(call => call.callee)).toEqual(['createApplication', 'alias']);
    expect(calls.every(call => call.importSource === '@zipbul/core')).toBe(true);
  });

  it('should collect defineModule calls when defineModule is imported from @zipbul/core', () => {
    const source = [
      "import { defineModule } from '@zipbul/core';",
      "import * as zipbul from '@zipbul/core';",
      '',
      'export const appModule = defineModule({});',
      'export const otherModule = zipbul.defineModule({});',
    ].join('\n');
    const parser = new AstParser();
    const result = parseOrFail(parser, '/app/src/__module__.ts', source);
    const calls = result.defineModuleCalls ?? [];

    expect(calls.map(call => call.callee)).toEqual(['defineModule', 'zipbul.defineModule']);
    expect(calls.map(call => call.exportedName)).toEqual(['appModule', 'otherModule']);
    expect(calls.every(call => call.importSource === '@zipbul/core')).toBe(true);
  });

  it('should collect inject calls when inject is imported from @zipbul/common', () => {
    const source = [
      "import { inject } from '@zipbul/common';",
      "import * as zipbul from '@zipbul/common';",
      '',
      'const TokenA = 1;',
      '',
      'inject(TokenA);',
      'zipbul.inject(TokenA);',
      'inject(() => TokenA);',
      'inject(function () { return TokenA; });',
    ].join('\n');
    const parser = new AstParser();
    const result = parseOrFail(parser, '/app/src/main.ts', source);
    const calls = result.injectCalls ?? [];

    expect(calls.map(call => call.callee)).toEqual(['inject', 'zipbul.inject', 'inject', 'inject']);
    expect(calls.map(call => call.tokenKind)).toEqual(['token', 'token', 'thunk', 'thunk']);
    expect(calls.every(call => call.importSource === '@zipbul/common')).toBe(true);
  });

  it('should mark inject call invalid when argument count is not 1', () => {
    const source = [
      "import { inject } from '@zipbul/common';",
      '',
      'const TokenA = 1;',
      '',
      'inject(TokenA, TokenA);',
    ].join('\n');
    const parser = new AstParser();
    const result = parseOrFail(parser, '/app/src/main.ts', source);
    const calls = result.injectCalls ?? [];

    expect(calls).toHaveLength(1);
    expect(calls[0]?.callee).toBe('inject');
    expect(calls[0]?.tokenKind).toBe('invalid');
    expect(calls[0]?.token).toBeNull();
  });

  it('should parse Injectable decorator when class has Injectable decorator with options', () => {
    const source = [
      "import { Injectable } from '@zipbul/common';",
      '',
      "@Injectable({ visibility: 'module', scope: 'singleton' })",
      'export class MyService {}',
    ].join('\n');
    const parser = new AstParser();
    const result = parseOrFail(parser, '/app/src/service.ts', source);

    expect(result.classes).toHaveLength(1);
    expect(result.classes[0]?.className).toBe('MyService');
    expect(result.classes[0]?.decorators).toHaveLength(1);
    expect(result.classes[0]?.decorators[0]?.name).toBe('Injectable');
  });

  it('should collect re-exports when export declarations re-export from other modules', () => {
    const source = [
      "export { MyService } from './services/my.service';",
      "export * from './utils';",
    ].join('\n');
    const parser = new AstParser();
    const result = parseOrFail(parser, '/app/src/index.ts', source);

    expect(result.reExports).toHaveLength(2);
  });

  it('should resolve aliased decorator to original export name', () => {
    const source = [
      "import { Injectable as Inj } from '@zipbul/common';",
      '',
      "@Inj({ visibility: 'module', scope: 'singleton' })",
      'export class MyService {}',
    ].join('\n');
    const parser = new AstParser();
    const result = parseOrFail(parser, '/app/src/service.ts', source);

    expect(result.classes).toHaveLength(1);
    expect(result.classes[0]?.decorators[0]?.name).toBe('Injectable');
  });

  it('should resolve aliased identifier to original export name in __zipbul_ref', () => {
    const source = [
      "import { MyClass as Alias } from './my-class';",
      '',
      'export const ref = Alias;',
    ].join('\n');
    const parser = new AstParser();
    const result = parseOrFail(parser, '/app/src/consumer.ts', source);
    const refValue = result.exportedValues['ref'] as Record<string, unknown> | undefined;

    expect(refValue?.__zipbul_ref).toBe('MyClass');
  });

  it('should not alter non-aliased import identifier names', () => {
    const source = [
      "import { Injectable } from '@zipbul/common';",
      '',
      '@Injectable()',
      'export class MyService {}',
    ].join('\n');
    const parser = new AstParser();
    const result = parseOrFail(parser, '/app/src/service.ts', source);

    expect(result.classes[0]?.decorators[0]?.name).toBe('Injectable');
  });

  it('should resolve aliased lazy target to original export name', () => {
    const source = [
      "import { lazy } from '@zipbul/common';",
      "import { MyService as Svc } from './my-service';",
      "import { Injectable } from '@zipbul/common';",
      '',
      '@Injectable()',
      'export class Consumer {',
      '  constructor(private dep: any) {}',
      '}',
      '',
      'const ref = lazy(() => Svc);',
    ].join('\n');
    const parser = new AstParser();
    const result = parseOrFail(parser, '/app/src/consumer.ts', source);
    const localValues = result.localValues;
    const refValue = localValues['ref'] as Record<string, unknown> | undefined;

    expect(refValue?.__zipbul_lazy_ref).toBe('MyService');
  });

  it('should resolve aliased inject callee to original name', () => {
    const source = [
      "import { inject as inj } from '@zipbul/common';",
      '',
      'const TokenA = 1;',
      '',
      'inj(TokenA);',
    ].join('\n');
    const parser = new AstParser();
    const result = parseOrFail(parser, '/app/src/main.ts', source);
    const calls = result.injectCalls ?? [];

    expect(calls).toHaveLength(1);
    expect(calls[0]?.callee).toBe('inject');
    expect(calls[0]?.importSource).toBe('@zipbul/common');
  });

  it('should keep localName for default import identifiers', () => {
    const source = [
      "import DefaultClass from './default-class';",
      '',
      'export const ref = DefaultClass;',
    ].join('\n');
    const parser = new AstParser();
    const result = parseOrFail(parser, '/app/src/service.ts', source);
    const refValue = result.exportedValues['ref'] as Record<string, unknown> | undefined;

    expect(refValue?.__zipbul_ref).toBe('DefaultClass');
  });

  it('should keep localName for namespace import identifiers', () => {
    const source = [
      "import * as ns from './my-module';",
      '',
      'const val = ns.something;',
    ].join('\n');
    const parser = new AstParser();
    const result = parseOrFail(parser, '/app/src/main.ts', source);
    const localValues = result.localValues;
    const valRef = localValues['val'] as Record<string, unknown> | undefined;

    expect(valRef?.__zipbul_ref).toBe('ns.something');
  });

  describe('parseExpression unresolvable', () => {
    it('should return UnresolvableExpression for ternary expression in exported value', () => {
      const source = [
        'const flag = true;',
        "export const value = flag ? 'a' : 'b';",
      ].join('\n');
      const parser = new AstParser();
      const result = parseOrFail(parser, '/app/src/config.ts', source);
      const exported = result.exportedValues?.['value'] as AnalyzerValueRecord | undefined;

      expect(exported).toBeDefined();
      expect(exported?.[ZIPBUL_UNRESOLVABLE]).toBe(true);
    });

    it('should include nodeType, start, and end fields in UnresolvableExpression', () => {
      const source = [
        'const flag = true;',
        "export const value = flag ? 'a' : 'b';",
      ].join('\n');
      const parser = new AstParser();
      const result = parseOrFail(parser, '/app/src/config.ts', source);
      const exported = result.exportedValues?.['value'] as AnalyzerValueRecord | undefined;

      expect(exported?.nodeType).toBe('ConditionalExpression');
      expect(typeof exported?.start).toBe('number');
      expect(typeof exported?.end).toBe('number');
    });

    it('should return UnresolvableExpression for await expression in local value', () => {
      const source = [
        'const data = await fetch("/api");',
      ].join('\n');
      const parser = new AstParser();
      const result = parseOrFail(parser, '/app/src/loader.ts', source);
      const local = result.localValues?.['data'] as AnalyzerValueRecord | undefined;

      expect(local).toBeDefined();
      expect(local?.[ZIPBUL_UNRESOLVABLE]).toBe(true);
      expect(local?.nodeType).toBe('AwaitExpression');
    });

    it('should still resolve string literals correctly', () => {
      const source = [
        "export const name = 'hello';",
      ].join('\n');
      const parser = new AstParser();
      const result = parseOrFail(parser, '/app/src/constants.ts', source);

      expect(result.exportedValues?.['name']).toBe('hello');
    });

    it('should still resolve numeric literals correctly', () => {
      const source = [
        'export const count = 42;',
      ].join('\n');
      const parser = new AstParser();
      const result = parseOrFail(parser, '/app/src/constants.ts', source);

      expect(result.exportedValues?.['count']).toBe(42);
    });

    it('should still resolve object expressions correctly', () => {
      const source = [
        "export const config = { host: 'localhost', port: 3000 };",
      ].join('\n');
      const parser = new AstParser();
      const result = parseOrFail(parser, '/app/src/constants.ts', source);
      const config = result.exportedValues?.['config'] as AnalyzerValueRecord | undefined;

      expect(config?.host).toBe('localhost');
      expect(config?.port).toBe(3000);
    });

    it('should still resolve array expressions correctly', () => {
      const source = [
        "export const items = ['a', 'b', 'c'];",
      ].join('\n');
      const parser = new AstParser();
      const result = parseOrFail(parser, '/app/src/constants.ts', source);

      expect(result.exportedValues?.['items']).toEqual(['a', 'b', 'c']);
    });

    it('should still resolve identifier references correctly', () => {
      const source = [
        "import { MyClass } from './my-class';",
        '',
        'export const ref = MyClass;',
      ].join('\n');
      const parser = new AstParser();
      const result = parseOrFail(parser, '/app/src/consumer.ts', source);
      const refValue = result.exportedValues?.['ref'] as AnalyzerValueRecord | undefined;

      expect(refValue?.__zipbul_ref).toBe('MyClass');
    });

    it('should produce UnresolvableExpression in decorator arguments for unsupported expressions', () => {
      const source = [
        "import { Injectable } from '@zipbul/common';",
        '',
        "const flag = true;",
        "@Injectable(flag ? { scope: 'singleton' } : {})",
        'export class MyService {}',
      ].join('\n');
      const parser = new AstParser();
      const result = parseOrFail(parser, '/app/src/service.ts', source);
      const decoratorArgs = result.classes[0]?.decorators[0]?.arguments;

      expect(decoratorArgs).toHaveLength(1);

      const arg = decoratorArgs?.[0] as AnalyzerValueRecord | undefined;

      expect(arg?.[ZIPBUL_UNRESOLVABLE]).toBe(true);
      expect(arg?.nodeType).toBe('ConditionalExpression');
    });
  });

  describe('anonymous class detection', () => {
    it('should return error diagnostic when class declaration has no name', () => {
      const source = [
        'class {}',
      ].join('\n');
      const parser = new AstParser();
      const result = parser.parse('/app/src/anonymous.ts', source);

      expect(isErr(result)).toBe(true);

      if (isErr(result)) {
        expect(result.data.why).toMatch(/Anonymous classes/);
      }
    });

    it('should include file path in anonymous class error diagnostic', () => {
      const source = [
        'class {}',
      ].join('\n');
      const parser = new AstParser();
      const result = parser.parse('/app/src/broken.ts', source);

      expect(isErr(result)).toBe(true);

      if (isErr(result)) {
        expect(result.data.where?.file).toBe('/app/src/broken.ts');
      }
    });

    it('should parse named class declarations successfully', () => {
      const source = [
        "import { Injectable } from '@zipbul/common';",
        '',
        '@Injectable()',
        'export class UserService {}',
      ].join('\n');
      const parser = new AstParser();
      const result = parseOrFail(parser, '/app/src/user.service.ts', source);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0]?.className).toBe('UserService');
    });
  });
});