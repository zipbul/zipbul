import { describe, expect, it } from 'bun:test';
import { isErr } from '@zipbul/result';
import { ZIPBUL_FACTORY_CODE, ZIPBUL_IMPORT_SOURCE, ZIPBUL_REF, ZIPBUL_SPREAD, ZIPBUL_UNRESOLVABLE } from '@zipbul/common';

import type { ParseResult } from './parser-models';
import type { AnalyzerValueRecord } from './types';

// MUST: MUST-1 (createApplication identification)

import { AstParser } from './parser';

async function parseOrFail(parser: AstParser, filename: string, code: string): Promise<ParseResult> {
  const result = await parser.parse(filename, code);

  if (isErr(result)) {
    throw new Error(`Unexpected parse failure: ${result.data.why}`);
  }

  return result;
}

describe('AstParser', () => {
  it('should collect createApplication calls when createApplication is imported from @zipbul/core', async () => {
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
    const result = await parseOrFail(parser, '/app/src/main.ts', source);
    const calls = result.createApplicationCalls ?? [];

    expect(calls.map(call => call.callee)).toEqual(['ca', 'zipbul.createApplication']);
    expect(calls.every(call => call.importSource === '@zipbul/core')).toBe(true);
  });

  it('should collect createApplication calls when createApplication is called in variable initializers', async () => {
    const source = [
      "import { createApplication } from '@zipbul/core';",
      "import { createApplication as alias } from '@zipbul/core';",
      "import { AppModule } from './app.module';",
      '',
      'const app = createApplication(AppModule);',
      'export const exportedApp = alias(AppModule);',
    ].join('\n');
    const parser = new AstParser();
    const result = await parseOrFail(parser, '/app/src/main.ts', source);
    const calls = result.createApplicationCalls ?? [];

    expect(calls.map(call => call.callee)).toEqual(['createApplication', 'alias']);
    expect(calls.every(call => call.importSource === '@zipbul/core')).toBe(true);
  });

  it('should collect defineModule calls when defineModule is imported from @zipbul/core', async () => {
    const source = [
      "import { defineModule } from '@zipbul/core';",
      "import * as zipbul from '@zipbul/core';",
      '',
      'export const appModule = defineModule({});',
      'export const otherModule = zipbul.defineModule({});',
    ].join('\n');
    const parser = new AstParser();
    const result = await parseOrFail(parser, '/app/src/__module__.ts', source);
    const calls = result.defineModuleCalls ?? [];

    expect(calls.map(call => call.callee)).toEqual(['defineModule', 'zipbul.defineModule']);
    expect(calls.map(call => call.exportedName)).toEqual(['appModule', 'otherModule']);
    expect(calls.every(call => call.importSource === '@zipbul/core')).toBe(true);
  });

  it('should collect inject calls when inject is imported from @zipbul/common', async () => {
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
    const result = await parseOrFail(parser, '/app/src/main.ts', source);
    const calls = result.injectCalls ?? [];

    expect(calls.map(call => call.callee)).toEqual(['inject', 'zipbul.inject', 'inject', 'inject']);
    expect(calls.map(call => call.tokenKind)).toEqual(['token', 'token', 'thunk', 'thunk']);
    expect(calls.every(call => call.importSource === '@zipbul/common')).toBe(true);
  });

  it('should mark inject call invalid when argument count is not 1', async () => {
    const source = [
      "import { inject } from '@zipbul/common';",
      '',
      'const TokenA = 1;',
      '',
      'inject(TokenA, TokenA);',
    ].join('\n');
    const parser = new AstParser();
    const result = await parseOrFail(parser, '/app/src/main.ts', source);
    const calls = result.injectCalls ?? [];

    expect(calls).toHaveLength(1);
    expect(calls[0]?.callee).toBe('inject');
    expect(calls[0]?.tokenKind).toBe('invalid');
    expect(calls[0]?.token).toBeNull();
  });

  it('should parse Injectable decorator when class has Injectable decorator with options', async () => {
    const source = [
      "import { Injectable } from '@zipbul/common';",
      '',
      "@Injectable({ visibility: 'module', scope: 'singleton' })",
      'export class MyService {}',
    ].join('\n');
    const parser = new AstParser();
    const result = await parseOrFail(parser, '/app/src/service.ts', source);

    expect(result.classes).toHaveLength(1);
    expect(result.classes[0]?.className).toBe('MyService');
    expect(result.classes[0]?.decorators).toHaveLength(1);
    expect(result.classes[0]?.decorators[0]?.name).toBe('Injectable');
  });

  it('should collect re-exports when export declarations re-export from other modules', async () => {
    const source = [
      "export { MyService } from './services/my.service';",
      "export * from './utils';",
    ].join('\n');
    const parser = new AstParser();
    const result = await parseOrFail(parser, '/app/src/index.ts', source);

    expect(result.reExports).toHaveLength(2);
  });

  it('should resolve aliased decorator to original export name', async () => {
    const source = [
      "import { Injectable as Inj } from '@zipbul/common';",
      '',
      "@Inj({ visibility: 'module', scope: 'singleton' })",
      'export class MyService {}',
    ].join('\n');
    const parser = new AstParser();
    const result = await parseOrFail(parser, '/app/src/service.ts', source);

    expect(result.classes).toHaveLength(1);
    expect(result.classes[0]?.decorators[0]?.name).toBe('Injectable');
  });

  it('should resolve aliased identifier to original export name in __zipbul_ref', async () => {
    const source = [
      "import { MyClass as Alias } from './my-class';",
      '',
      'export const ref = Alias;',
    ].join('\n');
    const parser = new AstParser();
    const result = await parseOrFail(parser, '/app/src/consumer.ts', source);
    const refValue = result.exportedValues?.['ref'] as Record<string, unknown> | undefined;

    expect(refValue?.__zipbul_ref).toBe('MyClass');
  });

  it('should not alter non-aliased import identifier names', async () => {
    const source = [
      "import { Injectable } from '@zipbul/common';",
      '',
      '@Injectable()',
      'export class MyService {}',
    ].join('\n');
    const parser = new AstParser();
    const result = await parseOrFail(parser, '/app/src/service.ts', source);

    expect(result.classes[0]?.decorators[0]?.name).toBe('Injectable');
  });

  it('should resolve aliased lazy target to original export name', async () => {
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
    const result = await parseOrFail(parser, '/app/src/consumer.ts', source);
    const localValues = result.localValues;
    const refValue = localValues?.['ref'] as Record<string, unknown> | undefined;

    expect(refValue?.__zipbul_lazy_ref).toBe('MyService');
  });

  it('should resolve aliased inject callee to original name', async () => {
    const source = [
      "import { inject as inj } from '@zipbul/common';",
      '',
      'const TokenA = 1;',
      '',
      'inj(TokenA);',
    ].join('\n');
    const parser = new AstParser();
    const result = await parseOrFail(parser, '/app/src/main.ts', source);
    const calls = result.injectCalls ?? [];

    expect(calls).toHaveLength(1);
    expect(calls[0]?.callee).toBe('inject');
    expect(calls[0]?.importSource).toBe('@zipbul/common');
  });

  it('should keep localName for default import identifiers', async () => {
    const source = [
      "import DefaultClass from './default-class';",
      '',
      'export const ref = DefaultClass;',
    ].join('\n');
    const parser = new AstParser();
    const result = await parseOrFail(parser, '/app/src/service.ts', source);
    const refValue = result.exportedValues?.['ref'] as Record<string, unknown> | undefined;

    expect(refValue?.__zipbul_ref).toBe('DefaultClass');
  });

  it('should keep localName for namespace import identifiers', async () => {
    const source = [
      "import * as ns from './my-module';",
      '',
      'const val = ns.something;',
    ].join('\n');
    const parser = new AstParser();
    const result = await parseOrFail(parser, '/app/src/main.ts', source);
    const localValues = result.localValues;
    const valRef = localValues?.['val'] as Record<string, unknown> | undefined;

    expect(valRef?.__zipbul_ref).toBe('ns.something');
  });

  describe('parseExpression unresolvable', () => {
    it('should return UnresolvableExpression for ternary expression in exported value', async () => {
      const source = [
        'const flag = true;',
        "export const value = flag ? 'a' : 'b';",
      ].join('\n');
      const parser = new AstParser();
      const result = await parseOrFail(parser, '/app/src/config.ts', source);
      const exported = result.exportedValues?.['value'] as AnalyzerValueRecord | undefined;

      expect(exported).toBeDefined();
      expect(exported?.[ZIPBUL_UNRESOLVABLE]).toBe(true);
    });

    it('should include sourceText field in UnresolvableExpression', async () => {
      const source = [
        'const flag = true;',
        "export const value = flag ? 'a' : 'b';",
      ].join('\n');
      const parser = new AstParser();
      const result = await parseOrFail(parser, '/app/src/config.ts', source);
      const exported = result.exportedValues?.['value'] as AnalyzerValueRecord | undefined;

      expect(exported?.sourceText).toBe("flag ? 'a' : 'b'");
    });

    it('should return UnresolvableExpression for await expression in local value', async () => {
      const source = [
        'const data = await fetch("/api");',
      ].join('\n');
      const parser = new AstParser();
      const result = await parseOrFail(parser, '/app/src/loader.ts', source);
      const local = result.localValues?.['data'] as AnalyzerValueRecord | undefined;

      expect(local).toBeDefined();
      expect(local?.[ZIPBUL_UNRESOLVABLE]).toBe(true);
      expect(local?.sourceText).toBe('await fetch("/api")');
    });

    it('should still resolve string literals correctly', async () => {
      const source = [
        "export const name = 'hello';",
      ].join('\n');
      const parser = new AstParser();
      const result = await parseOrFail(parser, '/app/src/constants.ts', source);

      expect(result.exportedValues?.['name']).toBe('hello');
    });

    it('should still resolve numeric literals correctly', async () => {
      const source = [
        'export const count = 42;',
      ].join('\n');
      const parser = new AstParser();
      const result = await parseOrFail(parser, '/app/src/constants.ts', source);

      expect(result.exportedValues?.['count']).toBe(42);
    });

    it('should still resolve object expressions correctly', async () => {
      const source = [
        "export const config = { host: 'localhost', port: 3000 };",
      ].join('\n');
      const parser = new AstParser();
      const result = await parseOrFail(parser, '/app/src/constants.ts', source);
      const config = result.exportedValues?.['config'] as AnalyzerValueRecord | undefined;

      expect(config?.host).toBe('localhost');
      expect(config?.port).toBe(3000);
    });

    it('should still resolve array expressions correctly', async () => {
      const source = [
        "export const items = ['a', 'b', 'c'];",
      ].join('\n');
      const parser = new AstParser();
      const result = await parseOrFail(parser, '/app/src/constants.ts', source);

      expect(result.exportedValues?.['items']).toEqual(['a', 'b', 'c']);
    });

    it('should still resolve identifier references correctly', async () => {
      const source = [
        "import { MyClass } from './my-class';",
        '',
        'export const ref = MyClass;',
      ].join('\n');
      const parser = new AstParser();
      const result = await parseOrFail(parser, '/app/src/consumer.ts', source);
      const refValue = result.exportedValues?.['ref'] as AnalyzerValueRecord | undefined;

      expect(refValue?.__zipbul_ref).toBe('MyClass');
    });

    it('should produce UnresolvableExpression in decorator arguments for unsupported expressions', async () => {
      const source = [
        "import { Injectable } from '@zipbul/common';",
        '',
        "const flag = true;",
        "@Injectable(flag ? { scope: 'singleton' } : {})",
        'export class MyService {}',
      ].join('\n');
      const parser = new AstParser();
      const result = await parseOrFail(parser, '/app/src/service.ts', source);
      const decoratorArgs = result.classes[0]?.decorators[0]?.arguments;

      expect(decoratorArgs).toHaveLength(1);

      const arg = decoratorArgs?.[0] as AnalyzerValueRecord | undefined;

      expect(arg?.[ZIPBUL_UNRESOLVABLE]).toBe(true);
    });
  });

  describe('anonymous class detection', () => {
    it('should return error diagnostic when class declaration has no name', async () => {
      const source = [
        'class {}',
      ].join('\n');
      const parser = new AstParser();
      const result = await parser.parse('/app/src/anonymous.ts', source);

      expect(isErr(result)).toBe(true);

      if (isErr(result)) {
        expect(result.data.why).toMatch(/Anonymous classes/);
      }
    });

    it('should include file path in anonymous class error diagnostic', async () => {
      const source = [
        'class {}',
      ].join('\n');
      const parser = new AstParser();
      const result = await parser.parse('/app/src/broken.ts', source);

      expect(isErr(result)).toBe(true);

      if (isErr(result)) {
        expect(result.data.where?.file).toBe('/app/src/broken.ts');
      }
    });

    it('should parse named class declarations successfully', async () => {
      const source = [
        "import { Injectable } from '@zipbul/common';",
        '',
        '@Injectable()',
        'export class UserService {}',
      ].join('\n');
      const parser = new AstParser();
      const result = await parseOrFail(parser, '/app/src/user.service.ts', source);

      expect(result.classes).toHaveLength(1);
      expect(result.classes[0]?.className).toBe('UserService');
    });
  });

  describe('MemberExpression parsing (F-1)', () => {
    it('should parse nested MemberExpression (a.b.c) into dotted ref', async () => {
      const source = [
        "import { obj } from './data';",
        '',
        'export const result = obj.nested.value;',
      ].join('\n');
      const parser = new AstParser();
      const result = await parseOrFail(parser, '/app/src/test.ts', source);
      const exported = result.exportedValues as AnalyzerValueRecord;
      const record = exported?.result as AnalyzerValueRecord;

      expect(typeof record[ZIPBUL_REF]).toBe('string');
      expect(record[ZIPBUL_REF]).toBe('obj.nested.value');
      expect(record[ZIPBUL_IMPORT_SOURCE]).toBe('/app/src/data');
    });

    it('should parse computed property with StringLiteral (obj["key"])', async () => {
      const source = [
        "import { bundle } from './bundle';",
        '',
        'export const result = bundle["providers"];',
      ].join('\n');
      const parser = new AstParser();
      const result = await parseOrFail(parser, '/app/src/test.ts', source);
      const exported = result.exportedValues as AnalyzerValueRecord;
      const record = exported?.result as AnalyzerValueRecord;

      expect(typeof record[ZIPBUL_REF]).toBe('string');
      expect(record[ZIPBUL_REF]).toBe('bundle.providers');
    });

    it('should parse ChainExpression (obj?.key) by unwrapping', async () => {
      const source = [
        "import { bundle } from './bundle';",
        '',
        'export const result = bundle?.providers;',
      ].join('\n');
      const parser = new AstParser();
      const result = await parseOrFail(parser, '/app/src/test.ts', source);
      const exported = result.exportedValues as AnalyzerValueRecord;
      const record = exported?.result as AnalyzerValueRecord;

      expect(typeof record[ZIPBUL_REF]).toBe('string');
      expect(record[ZIPBUL_REF]).toBe('bundle.providers');
    });

    it('should parse spread of MemberExpression into ZIPBUL_SPREAD with ref', async () => {
      const source = [
        "import { defineModule } from '@zipbul/core';",
        "import { bundle } from './providers';",
        '',
        'export const mod = defineModule({',
        '  providers: [',
        '    ...bundle.items,',
        '  ],',
        '});',
      ].join('\n');
      const parser = new AstParser();
      const result = await parseOrFail(parser, '/app/src/__module__.ts', source);
      const callArgs = result.defineModuleCalls?.[0]?.args;

      expect(Array.isArray(callArgs)).toBe(true);

      const firstArg = callArgs?.[0] as AnalyzerValueRecord;
      const providers = firstArg?.providers as AnalyzerValueRecord[];

      expect(Array.isArray(providers)).toBe(true);
      expect(providers).toHaveLength(1);

      const spreadEntry = providers[0] as AnalyzerValueRecord;

      expect(spreadEntry[ZIPBUL_SPREAD]).toBeDefined();

      const spreadValue = spreadEntry[ZIPBUL_SPREAD] as AnalyzerValueRecord;

      expect(spreadValue[ZIPBUL_REF]).toBe('bundle.items');
      expect(spreadValue[ZIPBUL_IMPORT_SOURCE]).toBe('/app/src/providers');
    });

    it('should parse spread of optional chaining into ZIPBUL_SPREAD with ref', async () => {
      const source = [
        "import { defineModule } from '@zipbul/core';",
        "import { bundle } from './providers';",
        '',
        'export const mod = defineModule({',
        '  providers: [',
        '    ...bundle?.items,',
        '  ],',
        '});',
      ].join('\n');
      const parser = new AstParser();
      const result = await parseOrFail(parser, '/app/src/__module__.ts', source);
      const callArgs = result.defineModuleCalls?.[0]?.args;

      expect(Array.isArray(callArgs)).toBe(true);

      const firstArg = callArgs?.[0] as AnalyzerValueRecord;
      const providers = firstArg?.providers as AnalyzerValueRecord[];

      expect(Array.isArray(providers)).toBe(true);
      expect(providers).toHaveLength(1);

      const spreadEntry = providers[0] as AnalyzerValueRecord;

      expect(spreadEntry[ZIPBUL_SPREAD]).toBeDefined();

      const spreadValue = spreadEntry[ZIPBUL_SPREAD] as AnalyzerValueRecord;

      expect(spreadValue[ZIPBUL_REF]).toBe('bundle.items');
    });

    it('should return unresolvable for computed property with non-StringLiteral', async () => {
      const source = [
        "import { obj } from './data';",
        'const key = "dynamic";',
        '',
        'export const result = obj[key];',
      ].join('\n');
      const parser = new AstParser();
      const result = await parseOrFail(parser, '/app/src/test.ts', source);
      const exported = result.exportedValues as AnalyzerValueRecord;
      const resultValue = exported?.result as AnalyzerValueRecord | undefined;

      expect(resultValue?.[ZIPBUL_UNRESOLVABLE]).toBe(true);
    });
  });

  describe('extractFactoryParamTypes', () => {
    async function extractFactoryParams(code: string): Promise<AnalyzerValueRecord[]> {
      const parser = new AstParser();
      const result = await parseOrFail(parser, '/app/src/__module__.ts', code);
      const callArgs = result.defineModuleCalls?.[0]?.args;
      const firstArg = (callArgs?.[0] ?? {}) as AnalyzerValueRecord;
      const providers = firstArg.providers as AnalyzerValueRecord[];
      const factoryProvider = providers[0] as AnalyzerValueRecord;
      const factoryRecord = factoryProvider.useFactory as AnalyzerValueRecord;

      expect(factoryRecord[ZIPBUL_FACTORY_CODE]).toBeDefined();

      return (factoryRecord.__zipbul_factory_params ?? []) as AnalyzerValueRecord[];
    }

    it('should extract typed param from arrow function with single typed parameter', async () => {
      const source = [
        "import { defineModule } from '@zipbul/core';",
        "import { ConfigService } from './config.service';",
        '',
        'export const mod = defineModule({',
        '  providers: [{',
        "    provide: 'MyService',",
        '    useFactory: (config: ConfigService) => new Foo(config),',
        '  }],',
        '});',
      ].join('\n');
      const params = await extractFactoryParams(source);

      expect(params).toHaveLength(1);
      expect(params[0]?.name).toBe('config');
      expect(params[0]?.typeName).toBe('ConfigService');
    });

    it('should extract param with null typeName when no type annotation is present', async () => {
      const source = [
        "import { defineModule } from '@zipbul/core';",
        '',
        'export const mod = defineModule({',
        '  providers: [{',
        "    provide: 'MyService',",
        '    useFactory: (a) => a,',
        '  }],',
        '});',
      ].join('\n');
      const params = await extractFactoryParams(source);

      expect(params).toHaveLength(1);
      expect(params[0]?.name).toBe('a');
      expect(params[0]?.typeName).toBeNull();
    });

    it('should extract multiple typed params from arrow function', async () => {
      const source = [
        "import { defineModule } from '@zipbul/core';",
        "import { Foo } from './foo';",
        "import { Bar } from './bar';",
        '',
        'export const mod = defineModule({',
        '  providers: [{',
        "    provide: 'MyService',",
        '    useFactory: (a: Foo, b: Bar) => new MyService(a, b),',
        '  }],',
        '});',
      ].join('\n');
      const params = await extractFactoryParams(source);

      expect(params).toHaveLength(2);
      expect(params[0]?.name).toBe('a');
      expect(params[0]?.typeName).toBe('Foo');
      expect(params[1]?.name).toBe('b');
      expect(params[1]?.typeName).toBe('Bar');
    });

    it('should extract empty array when arrow function has no params', async () => {
      const source = [
        "import { defineModule } from '@zipbul/core';",
        '',
        'export const mod = defineModule({',
        '  providers: [{',
        "    provide: 'MyService',",
        '    useFactory: () => new Foo(),',
        '  }],',
        '});',
      ].join('\n');
      const params = await extractFactoryParams(source);

      expect(params).toHaveLength(0);
    });

    it('should degrade destructured param name to unknown while preserving type annotation', async () => {
      const source = [
        "import { defineModule } from '@zipbul/core';",
        "import { Config } from './config';",
        '',
        'export const mod = defineModule({',
        '  providers: [{',
        "    provide: 'MyService',",
        '    useFactory: ({ a }: Config) => new Foo(a),',
        '  }],',
        '});',
      ].join('\n');
      const params = await extractFactoryParams(source);

      expect(params).toHaveLength(1);
      expect(params[0]?.name).toBe('unknown');
      expect(params[0]?.typeName).toBe('Config');
    });
  });
});