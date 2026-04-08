import { describe, expect, it } from 'bun:test';
import { ZIPBUL_REF, ZIPBUL_IMPORT_SOURCE, ZIPBUL_FACTORY_CODE } from '@zipbul/common';
import { parseSource } from '@zipbul/gildash';
import type { ExtractedSymbol, ExpressionObject, ParsedFile } from '@zipbul/gildash';
import { isErr } from '@zipbul/result';

import type { DefineModuleCall, CreateApplicationCall, InjectCall } from '../parser-models';
import type { ConversionResult, ImportMap } from '../expression-converter';
import type { AnalyzerValue, AnalyzerValueRecord } from '../types';

import {
  upsertDefineModuleCall,
  parsePatternCaptureArgs,
  convertModuleDefinition,
  detectFrameworkCallsFromInitializer,
  enrichFactoryValues,
  resolveExportDefaultDefineModule,
} from './framework-call-detector';

// --- Helpers ---

function makeDefineModuleCall(overrides: Partial<DefineModuleCall> = {}): DefineModuleCall {
  return {
    callee: 'defineModule',
    importSource: '@zipbul/core',
    args: [],
    ...overrides,
  };
}

function makeConversionResult(overrides: Partial<ConversionResult> = {}): ConversionResult {
  return {
    value: {},
    injectCalls: [],
    factoryRefs: [],
    ...overrides,
  };
}

function makeSymbol(overrides: Partial<ExtractedSymbol> = {}): ExtractedSymbol {
  return {
    kind: 'variable',
    name: 'testVar',
    span: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
    isExported: false,
    modifiers: [],
    ...overrides,
  };
}

function makeImportMap(entries: Array<[string, { importSource: string; originalName: string | null }]>): ImportMap {
  return new Map(entries);
}

function parseSafe(filePath: string, code: string): ParsedFile {
  const result = parseSource(filePath, code);

  if (isErr(result)) {
    throw new Error(`Parse failed: ${JSON.stringify(result.data)}`);
  }

  return result;
}

// --- Tests ---

describe('upsertDefineModuleCall', () => {
  it('should add a new call to an empty array', () => {
    const calls: DefineModuleCall[] = [];
    const call = makeDefineModuleCall({ callee: 'defineModule', localName: 'mod' });

    upsertDefineModuleCall(calls, call);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.localName).toBe('mod');
  });

  it('should add a new call when no matching offset exists', () => {
    const calls: DefineModuleCall[] = [
      makeDefineModuleCall({ start: 0, end: 10, localName: 'first' }),
    ];
    const call = makeDefineModuleCall({ start: 20, end: 30, localName: 'second' });

    upsertDefineModuleCall(calls, call);

    expect(calls).toHaveLength(2);
    expect(calls[1]?.localName).toBe('second');
  });

  it('should merge localName when call has same start/end offset', () => {
    const calls: DefineModuleCall[] = [
      makeDefineModuleCall({ start: 10, end: 50, localName: 'original' }),
    ];
    const call = makeDefineModuleCall({ start: 10, end: 50, localName: 'updated' });

    upsertDefineModuleCall(calls, call);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.localName).toBe('updated');
  });

  it('should merge exportedName when call has same start/end offset', () => {
    const calls: DefineModuleCall[] = [
      makeDefineModuleCall({ start: 10, end: 50, exportedName: undefined }),
    ];
    const call = makeDefineModuleCall({ start: 10, end: 50, exportedName: 'myExport' });

    upsertDefineModuleCall(calls, call);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.exportedName).toBe('myExport');
  });

  it('should preserve existing exportedName when incoming call has no exportedName', () => {
    const calls: DefineModuleCall[] = [
      makeDefineModuleCall({ start: 10, end: 50, exportedName: 'existing' }),
    ];
    const call = makeDefineModuleCall({ start: 10, end: 50 });

    upsertDefineModuleCall(calls, call);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.exportedName).toBe('existing');
  });

  it('should push call when start is undefined', () => {
    const calls: DefineModuleCall[] = [
      makeDefineModuleCall({ start: 10, end: 50 }),
    ];
    const call = makeDefineModuleCall({ start: undefined, end: 50, localName: 'noStart' });

    upsertDefineModuleCall(calls, call);

    expect(calls).toHaveLength(2);
    expect(calls[1]?.localName).toBe('noStart');
  });

  it('should push call when end is undefined', () => {
    const calls: DefineModuleCall[] = [
      makeDefineModuleCall({ start: 10, end: 50 }),
    ];
    const call = makeDefineModuleCall({ start: 10, end: undefined, localName: 'noEnd' });

    upsertDefineModuleCall(calls, call);

    expect(calls).toHaveLength(2);
    expect(calls[1]?.localName).toBe('noEnd');
  });

  it('should keep multiple calls with different offsets', () => {
    const calls: DefineModuleCall[] = [];

    upsertDefineModuleCall(calls, makeDefineModuleCall({ start: 0, end: 10, localName: 'a' }));
    upsertDefineModuleCall(calls, makeDefineModuleCall({ start: 20, end: 30, localName: 'b' }));
    upsertDefineModuleCall(calls, makeDefineModuleCall({ start: 40, end: 50, localName: 'c' }));

    expect(calls).toHaveLength(3);
    expect(calls.map(entry => entry.localName)).toEqual(['a', 'b', 'c']);
  });

  it('should merge both localName and exportedName simultaneously on same offset', () => {
    const calls: DefineModuleCall[] = [
      makeDefineModuleCall({ start: 5, end: 15 }),
    ];
    const call = makeDefineModuleCall({ start: 5, end: 15, localName: 'newLocal', exportedName: 'newExport' });

    upsertDefineModuleCall(calls, call);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.localName).toBe('newLocal');
    expect(calls[0]?.exportedName).toBe('newExport');
  });
});

describe('parsePatternCaptureArgs', () => {
  it('should return empty array for empty string', () => {
    const result = parsePatternCaptureArgs('', new Map(), {}, {});

    expect(result).toEqual([]);
  });

  it('should return empty array for whitespace-only string', () => {
    const result = parsePatternCaptureArgs('   ', new Map(), {}, {});

    expect(result).toEqual([]);
  });

  it('should resolve simple identifier through import map', () => {
    const importMap = makeImportMap([
      ['MyService', { importSource: './my.service', originalName: null }],
    ]);

    const result = parsePatternCaptureArgs('MyService', importMap, {}, {});

    expect(result).toHaveLength(1);

    const ref = result[0] as AnalyzerValueRecord;

    expect(ref[ZIPBUL_REF]).toBe('MyService');
    expect(ref[ZIPBUL_IMPORT_SOURCE]).toBe('./my.service');
  });

  it('should resolve aliased import to original name through import map', () => {
    const importMap = makeImportMap([
      ['Alias', { importSource: './service', originalName: 'OriginalName' }],
    ]);

    const result = parsePatternCaptureArgs('Alias', importMap, {}, {});

    expect(result).toHaveLength(1);

    const ref = result[0] as AnalyzerValueRecord;

    expect(ref[ZIPBUL_REF]).toBe('OriginalName');
    expect(ref[ZIPBUL_IMPORT_SOURCE]).toBe('./service');
  });

  it('should fall back to currentImports when identifier is not in import map', () => {
    const importMap: ImportMap = new Map();
    const currentImports = { SomeClass: './some-class' };

    const result = parsePatternCaptureArgs('SomeClass', importMap, currentImports, {});

    expect(result).toHaveLength(1);

    const ref = result[0] as AnalyzerValueRecord;

    expect(ref[ZIPBUL_REF]).toBe('SomeClass');
    expect(ref[ZIPBUL_IMPORT_SOURCE]).toBe('./some-class');
  });

  it('should use currentOriginalNames for fallback identifier resolution', () => {
    const importMap: ImportMap = new Map();
    const currentImports = { Alias: './module' };
    const currentOriginalNames = { Alias: 'RealName' };

    const result = parsePatternCaptureArgs('Alias', importMap, currentImports, currentOriginalNames);

    expect(result).toHaveLength(1);

    const ref = result[0] as AnalyzerValueRecord;

    expect(ref[ZIPBUL_REF]).toBe('RealName');
    expect(ref[ZIPBUL_IMPORT_SOURCE]).toBe('./module');
  });

  it('should resolve member expression (ns.Something) with import source', () => {
    const currentImports = { ns: './namespace-module' };

    const result = parsePatternCaptureArgs('ns.Something', new Map(), currentImports, {});

    expect(result).toHaveLength(1);

    const ref = result[0] as AnalyzerValueRecord;

    expect(ref[ZIPBUL_REF]).toBe('ns.Something');
    expect(ref[ZIPBUL_IMPORT_SOURCE]).toBe('./namespace-module');
  });

  it('should resolve member expression with original name for namespace object', () => {
    const currentImports = { alias: './lib' };
    const currentOriginalNames = { alias: 'original' };

    const result = parsePatternCaptureArgs('alias.Foo', new Map(), currentImports, currentOriginalNames);

    expect(result).toHaveLength(1);

    const ref = result[0] as AnalyzerValueRecord;

    expect(ref[ZIPBUL_REF]).toBe('original.Foo');
    expect(ref[ZIPBUL_IMPORT_SOURCE]).toBe('./lib');
  });

  it('should parse complex args via gildash for object literal', () => {
    const result = parsePatternCaptureArgs("{ host: 'localhost', port: 3000 }", new Map(), {}, {});

    expect(result).toHaveLength(1);

    const record = result[0] as AnalyzerValueRecord;

    expect(record.host).toBe('localhost');
    expect(record.port).toBe(3000);
  });

  it('should parse complex args via gildash for array literal', () => {
    const result = parsePatternCaptureArgs("'a', 'b', 'c'", new Map(), {}, {});

    expect(result).toHaveLength(3);
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('should parse string literal as single-element array', () => {
    const result = parsePatternCaptureArgs("'hello'", new Map(), {}, {});

    expect(result).toHaveLength(1);
    expect(result[0]).toBe('hello');
  });

  it('should treat bare numeric string as simple identifier fallback', () => {
    const result = parsePatternCaptureArgs('42', new Map(), {}, {});

    expect(result).toHaveLength(1);

    const ref = result[0] as AnalyzerValueRecord;

    expect(ref[ZIPBUL_REF]).toBe('42');
  });

  it('should return empty array when complex args fail to parse', () => {
    const result = parsePatternCaptureArgs('{{{{invalid syntax', new Map(), {}, {});

    expect(result).toEqual([]);
  });

  it('should handle identifier not found in any map gracefully', () => {
    const result = parsePatternCaptureArgs('UnknownIdent', new Map(), {}, {});

    expect(result).toHaveLength(1);

    const ref = result[0] as AnalyzerValueRecord;

    expect(ref[ZIPBUL_REF]).toBe('UnknownIdent');
    expect(ref[ZIPBUL_IMPORT_SOURCE]).toBeUndefined();
  });

  it('should handle member expression with no import source', () => {
    const result = parsePatternCaptureArgs('obj.prop', new Map(), {}, {});

    expect(result).toHaveLength(1);

    const ref = result[0] as AnalyzerValueRecord;

    expect(ref[ZIPBUL_REF]).toBe('obj.prop');
    expect(ref[ZIPBUL_IMPORT_SOURCE]).toBeUndefined();
  });
});

describe('convertModuleDefinition', () => {
  it('should return ModuleDefinition with name when name property is a string', () => {
    const expr: ExpressionObject = {
      kind: 'object',
      properties: [
        { key: 'name', value: { kind: 'string', value: 'AppModule' } },
      ],
    };

    const result = convertModuleDefinition(expr, new Map(), {});

    expect(result.name).toBe('AppModule');
    expect(result.nameDeclared).toBe(true);
  });

  it('should set nameDeclared true even when name value is not a string', () => {
    const expr: ExpressionObject = {
      kind: 'object',
      properties: [
        { key: 'name', value: { kind: 'number', value: 42 } },
      ],
    };

    const result = convertModuleDefinition(expr, new Map(), {});

    expect(result.name).toBeUndefined();
    expect(result.nameDeclared).toBe(true);
  });

  it('should extract providers from array property', () => {
    const expr: ExpressionObject = {
      kind: 'object',
      properties: [
        {
          key: 'providers',
          value: {
            kind: 'array',
            elements: [
              { kind: 'identifier', name: 'ServiceA' },
              { kind: 'identifier', name: 'ServiceB' },
            ],
          },
        },
      ],
    };

    const result = convertModuleDefinition(expr, new Map(), {});

    expect(result.providers).toHaveLength(2);
  });

  it('should extract adapters value', () => {
    const expr: ExpressionObject = {
      kind: 'object',
      properties: [
        {
          key: 'adapters',
          value: { kind: 'identifier', name: 'HttpAdapter' },
        },
      ],
    };

    const result = convertModuleDefinition(expr, new Map(), {});

    expect(result.adapters).toBeDefined();
  });

  it('should return defaults for minimal expression with no properties', () => {
    const expr: ExpressionObject = {
      kind: 'object',
      properties: [],
    };

    const result = convertModuleDefinition(expr, new Map(), {});

    expect(result.name).toBeUndefined();
    expect(result.nameDeclared).toBe(false);
    expect(result.providers).toEqual([]);
    expect(result.adapters).toBeUndefined();
  });

  it('should copy currentImports into result imports', () => {
    const expr: ExpressionObject = {
      kind: 'object',
      properties: [],
    };
    const currentImports = { MyService: './my.service' };

    const result = convertModuleDefinition(expr, new Map(), currentImports);

    expect(result.imports).toEqual({ MyService: './my.service' });
  });

  it('should not share reference with original currentImports object', () => {
    const expr: ExpressionObject = {
      kind: 'object',
      properties: [],
    };
    const currentImports = { Svc: './svc' };

    const result = convertModuleDefinition(expr, new Map(), currentImports);

    expect(result.imports).not.toBe(currentImports);
  });

  it('should ignore providers when value is not an array kind', () => {
    const expr: ExpressionObject = {
      kind: 'object',
      properties: [
        {
          key: 'providers',
          value: { kind: 'identifier', name: 'someRef' },
        },
      ],
    };

    const result = convertModuleDefinition(expr, new Map(), {});

    expect(result.providers).toEqual([]);
  });

  it('should handle expression with all properties present', () => {
    const expr: ExpressionObject = {
      kind: 'object',
      properties: [
        { key: 'name', value: { kind: 'string', value: 'TestModule' } },
        {
          key: 'providers',
          value: {
            kind: 'array',
            elements: [{ kind: 'string', value: 'token' }],
          },
        },
        {
          key: 'adapters',
          value: { kind: 'identifier', name: 'Adapter' },
        },
      ],
    };

    const result = convertModuleDefinition(expr, new Map(), {});

    expect(result.name).toBe('TestModule');
    expect(result.nameDeclared).toBe(true);
    expect(result.providers).toHaveLength(1);
    expect(result.adapters).toBeDefined();
  });
});

describe('detectFrameworkCallsFromInitializer', () => {
  it('should detect createApplication call with direct name', () => {
    const symbol = makeSymbol({
      initializer: {
        kind: 'call',
        callee: 'createApplication',
        importSource: '@zipbul/core',
        arguments: [],
      },
    });
    const conversionResult = makeConversionResult({
      value: { args: [{ [ZIPBUL_REF]: 'AppModule' }] },
    });
    const createApplicationCalls: CreateApplicationCall[] = [];
    const defineModuleCalls: DefineModuleCall[] = [];

    detectFrameworkCallsFromInitializer(
      symbol, conversionResult,
      new Set(['createApplication']), new Set(),
      new Set(), new Set(),
      createApplicationCalls, defineModuleCalls,
    );

    expect(createApplicationCalls).toHaveLength(1);
    expect(createApplicationCalls[0]?.callee).toBe('createApplication');
    expect(defineModuleCalls).toHaveLength(0);
  });

  it('should detect createApplication call with alias', () => {
    const symbol = makeSymbol({
      initializer: {
        kind: 'call',
        callee: 'ca',
        importSource: '@zipbul/core',
        arguments: [],
      },
    });
    const conversionResult = makeConversionResult({ value: { args: [] } });
    const createApplicationCalls: CreateApplicationCall[] = [];
    const defineModuleCalls: DefineModuleCall[] = [];

    detectFrameworkCallsFromInitializer(
      symbol, conversionResult,
      new Set(['ca']), new Set(),
      new Set(), new Set(),
      createApplicationCalls, defineModuleCalls,
    );

    expect(createApplicationCalls).toHaveLength(1);
    expect(createApplicationCalls[0]?.callee).toBe('ca');
  });

  it('should detect namespace-qualified createApplication call', () => {
    const symbol = makeSymbol({
      initializer: {
        kind: 'call',
        callee: 'zipbul.createApplication',
        importSource: '@zipbul/core',
        arguments: [],
      },
    });
    const conversionResult = makeConversionResult({ value: { args: [] } });
    const createApplicationCalls: CreateApplicationCall[] = [];
    const defineModuleCalls: DefineModuleCall[] = [];

    detectFrameworkCallsFromInitializer(
      symbol, conversionResult,
      new Set(), new Set(['zipbul']),
      new Set(), new Set(),
      createApplicationCalls, defineModuleCalls,
    );

    expect(createApplicationCalls).toHaveLength(1);
    expect(createApplicationCalls[0]?.callee).toBe('zipbul.createApplication');
  });

  it('should detect defineModule call with direct name', () => {
    const symbol = makeSymbol({
      name: 'appModule',
      isExported: true,
      initializer: {
        kind: 'call',
        callee: 'defineModule',
        importSource: '@zipbul/core',
        arguments: [],
      },
    });
    const conversionResult = makeConversionResult({ value: { args: [] } });
    const createApplicationCalls: CreateApplicationCall[] = [];
    const defineModuleCalls: DefineModuleCall[] = [];

    detectFrameworkCallsFromInitializer(
      symbol, conversionResult,
      new Set(), new Set(),
      new Set(['defineModule']), new Set(),
      createApplicationCalls, defineModuleCalls,
    );

    expect(defineModuleCalls).toHaveLength(1);
    expect(defineModuleCalls[0]?.callee).toBe('defineModule');
    expect(defineModuleCalls[0]?.localName).toBe('appModule');
    expect(defineModuleCalls[0]?.exportedName).toBe('appModule');
  });

  it('should detect namespace-qualified defineModule call', () => {
    const symbol = makeSymbol({
      name: 'mod',
      isExported: false,
      initializer: {
        kind: 'call',
        callee: 'core.defineModule',
        importSource: '@zipbul/core',
        arguments: [],
      },
    });
    const conversionResult = makeConversionResult({ value: { args: [] } });
    const createApplicationCalls: CreateApplicationCall[] = [];
    const defineModuleCalls: DefineModuleCall[] = [];

    detectFrameworkCallsFromInitializer(
      symbol, conversionResult,
      new Set(), new Set(),
      new Set(), new Set(['core']),
      createApplicationCalls, defineModuleCalls,
    );

    expect(defineModuleCalls).toHaveLength(1);
    expect(defineModuleCalls[0]?.callee).toBe('core.defineModule');
    expect(defineModuleCalls[0]?.localName).toBe('mod');
    expect(defineModuleCalls[0]?.exportedName).toBeUndefined();
  });

  it('should not detect regular function call that is not from @zipbul/core', () => {
    const symbol = makeSymbol({
      initializer: {
        kind: 'call',
        callee: 'createApplication',
        importSource: 'other-package',
        arguments: [],
      },
    });
    const conversionResult = makeConversionResult();
    const createApplicationCalls: CreateApplicationCall[] = [];
    const defineModuleCalls: DefineModuleCall[] = [];

    detectFrameworkCallsFromInitializer(
      symbol, conversionResult,
      new Set(['createApplication']), new Set(),
      new Set(), new Set(),
      createApplicationCalls, defineModuleCalls,
    );

    expect(createApplicationCalls).toHaveLength(0);
    expect(defineModuleCalls).toHaveLength(0);
  });

  it('should not detect when initializer is undefined', () => {
    const symbol = makeSymbol({ initializer: undefined });
    const conversionResult = makeConversionResult();
    const createApplicationCalls: CreateApplicationCall[] = [];
    const defineModuleCalls: DefineModuleCall[] = [];

    detectFrameworkCallsFromInitializer(
      symbol, conversionResult,
      new Set(), new Set(),
      new Set(), new Set(),
      createApplicationCalls, defineModuleCalls,
    );

    expect(createApplicationCalls).toHaveLength(0);
    expect(defineModuleCalls).toHaveLength(0);
  });

  it('should not detect when initializer is not a call kind', () => {
    const symbol = makeSymbol({
      initializer: { kind: 'identifier', name: 'someRef' },
    });
    const conversionResult = makeConversionResult();
    const createApplicationCalls: CreateApplicationCall[] = [];
    const defineModuleCalls: DefineModuleCall[] = [];

    detectFrameworkCallsFromInitializer(
      symbol, conversionResult,
      new Set(), new Set(),
      new Set(), new Set(),
      createApplicationCalls, defineModuleCalls,
    );

    expect(createApplicationCalls).toHaveLength(0);
    expect(defineModuleCalls).toHaveLength(0);
  });

  it('should extract args from conversion result record', () => {
    const symbol = makeSymbol({
      initializer: {
        kind: 'call',
        callee: 'createApplication',
        importSource: '@zipbul/core',
        arguments: [],
      },
    });
    const argValue: AnalyzerValue = { [ZIPBUL_REF]: 'AppModule', [ZIPBUL_IMPORT_SOURCE]: './app.module' };
    const conversionResult = makeConversionResult({
      value: { args: [argValue] },
    });
    const createApplicationCalls: CreateApplicationCall[] = [];

    detectFrameworkCallsFromInitializer(
      symbol, conversionResult,
      new Set(['createApplication']), new Set(),
      new Set(), new Set(),
      createApplicationCalls, [],
    );

    expect(createApplicationCalls[0]?.args).toHaveLength(1);
  });

  it('should use empty args when conversion value is not a record', () => {
    const symbol = makeSymbol({
      initializer: {
        kind: 'call',
        callee: 'createApplication',
        importSource: '@zipbul/core',
        arguments: [],
      },
    });
    const conversionResult = makeConversionResult({ value: 'not-a-record' });
    const createApplicationCalls: CreateApplicationCall[] = [];

    detectFrameworkCallsFromInitializer(
      symbol, conversionResult,
      new Set(['createApplication']), new Set(),
      new Set(), new Set(),
      createApplicationCalls, [],
    );

    expect(createApplicationCalls[0]?.args).toEqual([]);
  });

  it('should not detect namespace call when method name does not match', () => {
    const symbol = makeSymbol({
      initializer: {
        kind: 'call',
        callee: 'zipbul.someOtherMethod',
        importSource: '@zipbul/core',
        arguments: [],
      },
    });
    const conversionResult = makeConversionResult({ value: { args: [] } });
    const createApplicationCalls: CreateApplicationCall[] = [];
    const defineModuleCalls: DefineModuleCall[] = [];

    detectFrameworkCallsFromInitializer(
      symbol, conversionResult,
      new Set(), new Set(['zipbul']),
      new Set(), new Set(['zipbul']),
      createApplicationCalls, defineModuleCalls,
    );

    expect(createApplicationCalls).toHaveLength(0);
    expect(defineModuleCalls).toHaveLength(0);
  });
});

describe('enrichFactoryValues', () => {
  it('should return original value when factoryRefs is empty', () => {
    const conversionResult = makeConversionResult({ value: 'original' });
    const parsed = parseSafe('test.ts', 'const x = 1;');

    const result = enrichFactoryValues(
      conversionResult, parsed, 'x', [], [], '/test.ts', {}, {}, {}, [],
    );

    expect(result).toBe('original');
  });

  it('should return original value when value is not a record', () => {
    const conversionResult = makeConversionResult({
      value: 'string-value',
      factoryRefs: [{ sourceText: '() => 1', path: [] }],
    });
    const parsed = parseSafe('test.ts', 'const x = () => 1;');

    const result = enrichFactoryValues(
      conversionResult, parsed, 'x', [], [], '/test.ts', {}, {}, {}, [],
    );

    expect(result).toBe('string-value');
  });

  it('should return original value when record has no factory code', () => {
    const conversionResult = makeConversionResult({
      value: { someKey: 'someValue' },
      factoryRefs: [{ sourceText: '() => 1', path: [] }],
    });
    const parsed = parseSafe('test.ts', 'const x = () => 1;');

    const result = enrichFactoryValues(
      conversionResult, parsed, 'x', [], [], '/test.ts', {}, {}, {}, [],
    );

    expect(result).toEqual({ someKey: 'someValue' });
  });

  it('should return original record when factory code is present but variable not found in AST', () => {
    const conversionResult = makeConversionResult({
      value: { [ZIPBUL_FACTORY_CODE]: '() => 1' },
      factoryRefs: [{ sourceText: '() => 1', path: [] }],
    });
    const parsed = parseSafe('test.ts', 'const otherName = 1;');

    const result = enrichFactoryValues(
      conversionResult, parsed, 'nonExistent', [], [], '/test.ts', {}, {}, {}, [],
    );

    expect(result).toEqual({ [ZIPBUL_FACTORY_CODE]: '() => 1' });
  });

  it('should enrich record with factory deps and injects when variable init is found', () => {
    const code = 'const myFactory = (a: string) => a;';
    const parsed = parseSafe('test.ts', code);
    const conversionResult = makeConversionResult({
      value: { [ZIPBUL_FACTORY_CODE]: '(a: string) => a' },
      factoryRefs: [{ sourceText: '(a: string) => a', path: [] }],
    });
    const injectCalls: InjectCall[] = [];

    const result = enrichFactoryValues(
      conversionResult, parsed, 'myFactory', [], [], '/test.ts', {}, {}, {}, injectCalls,
    );

    const record = result as AnalyzerValueRecord;

    expect(record[ZIPBUL_FACTORY_CODE]).toBe('(a: string) => a');
    expect(record.__zipbul_factory_deps).toBeDefined();
    expect(record.__zipbul_factory_injects).toBeDefined();
  });
});

describe('resolveExportDefaultDefineModule', () => {
  it('should not modify calls when defineModuleCalls is empty', () => {
    const parsed = parseSafe('test.ts', 'export default 1;');
    const calls: DefineModuleCall[] = [];

    resolveExportDefaultDefineModule(parsed, calls);

    expect(calls).toHaveLength(0);
  });

  it('should set exportedName to default for inline export default call expression', () => {
    const code = "import { defineModule } from '@zipbul/core';\nexport default defineModule({});";
    const parsed = parseSafe('test.ts', code);

    const body = parsed.program.body;
    const exportDefault = body.find(stmt => stmt.type === 'ExportDefaultDeclaration');
    const callExpr = (exportDefault as Record<string, unknown>)?.declaration as { start: number; end: number };

    const calls: DefineModuleCall[] = [
      makeDefineModuleCall({ start: callExpr.start, end: callExpr.end }),
    ];

    resolveExportDefaultDefineModule(parsed, calls);

    expect(calls[0]?.exportedName).toBe('default');
  });

  it('should set exportedName to default for export default identifier reference', () => {
    const code = [
      "import { defineModule } from '@zipbul/core';",
      'const myModule = defineModule({});',
      'export default myModule;',
    ].join('\n');
    const parsed = parseSafe('test.ts', code);

    const calls: DefineModuleCall[] = [
      makeDefineModuleCall({ localName: 'myModule' }),
    ];

    resolveExportDefaultDefineModule(parsed, calls);

    expect(calls[0]?.exportedName).toBe('default');
  });

  it('should not modify exportedName when export default does not match any call', () => {
    const code = [
      'const other = 1;',
      'export default other;',
    ].join('\n');
    const parsed = parseSafe('test.ts', code);

    const calls: DefineModuleCall[] = [
      makeDefineModuleCall({ localName: 'myModule', exportedName: 'original' }),
    ];

    resolveExportDefaultDefineModule(parsed, calls);

    expect(calls[0]?.exportedName).toBe('original');
  });

  it('should not modify calls when there is no ExportDefaultDeclaration', () => {
    const code = 'const x = 1;';
    const parsed = parseSafe('test.ts', code);

    const calls: DefineModuleCall[] = [
      makeDefineModuleCall({ localName: 'x', exportedName: 'kept' }),
    ];

    resolveExportDefaultDefineModule(parsed, calls);

    expect(calls[0]?.exportedName).toBe('kept');
  });

  it('should not match when export default declaration is not a call or identifier', () => {
    const code = 'export default { key: "value" };';
    const parsed = parseSafe('test.ts', code);

    const calls: DefineModuleCall[] = [
      makeDefineModuleCall({ localName: 'myModule' }),
    ];

    resolveExportDefaultDefineModule(parsed, calls);

    expect(calls[0]?.exportedName).toBeUndefined();
  });
});
