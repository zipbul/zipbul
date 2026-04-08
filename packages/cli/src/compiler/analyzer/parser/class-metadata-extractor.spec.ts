import { describe, expect, it, mock } from 'bun:test';
import { parseSource, extractSymbols } from '@zipbul/gildash';
import type { ParsedFile, ExtractedSymbol } from '@zipbul/gildash';
import { isErr, err } from '@zipbul/result';
import { ZIPBUL_REF } from '@zipbul/common';

import type { ClassMetadata } from '../interfaces';
import { buildImportMap } from '../expression-converter';
import type { ImportMap } from '../expression-converter';
import { buildDiagnostic } from '../../../diagnostics';

import {
  convertClassSymbol,
  resolveTypeArgName,
} from './class-metadata-extractor';
import type {
  AstNodeLocatorCallbacks,
  MethodMetadataCallbacks,
  AnonymousClassCallback,
  ClassMetadataContext,
} from './class-metadata-extractor';
import { findClassAstNode, findMethodBodyAstNode, findPropertyAstNode, getMethodAstMeta } from './ast-node-locator';

interface ParseFixture {
  parsed: ParsedFile;
  symbols: ExtractedSymbol[];
  importMap: ImportMap;
}

function parseFixture(code: string, filename: string = '/app/src/test.ts'): ParseFixture {
  const parseResult = parseSource(filename, code);

  if (isErr(parseResult)) {
    throw new Error(`Unexpected parse failure`);
  }

  const parsed = parseResult;
  const symbols = extractSymbols(parsed);
  const importMap = buildImportMap(parsed.module.staticImports);

  return { parsed, symbols, importMap };
}

function findClassSymbol(symbols: ExtractedSymbol[], name: string): ExtractedSymbol {
  const symbol = symbols.find(s => s.kind === 'class' && s.name === name);

  if (symbol === undefined) {
    throw new Error(`Class symbol "${name}" not found`);
  }

  return symbol;
}

function createDefaultContext(filePath: string = '/app/src/test.ts'): ClassMetadataContext {
  return {
    currentFilePath: filePath,
    currentOriginalNames: {},
    resolvePath: (_sourcePath: string, importPath: string) => importPath,
  };
}

function createRealAstLocators(): AstNodeLocatorCallbacks {
  return {
    findClassAstNode,
    findMethodBodyAstNode,
    findPropertyAstNode,
    getMethodAstMeta,
  };
}

function createNoopMethodCallbacks(): MethodMetadataCallbacks {
  return {
    extractMiddlewaresFromConfigure: mock(() => []),
    extractExceptionFiltersFromConfigure: mock(() => []),
    extractTypedCalls: mock(() => []),
  };
}

function createDefaultAnonymousCheck(): AnonymousClassCallback {
  return {
    isAnonymousClassSymbol: mock(() => false),
  };
}

describe('convertClassSymbol', () => {
  it('should return basic ClassMetadata for simple class with no decorators or members', () => {
    const code = 'export class SimpleService {}';
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'SimpleService');

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      createDefaultContext(), createRealAstLocators(),
      createNoopMethodCallbacks(), createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;

    expect(metadata.className).toBe('SimpleService');
    expect(metadata.decorators).toEqual([]);
    expect(metadata.constructorParams).toEqual([]);
    expect(metadata.methods).toEqual([]);
    expect(metadata.properties).toEqual([]);
    expect(metadata.heritage).toBeUndefined();
    expect(metadata.middlewares).toEqual([]);
    expect(metadata.exceptionFilters).toEqual([]);
  });

  it('should populate decorators when class has @Injectable decorator', () => {
    const code = [
      "import { Injectable } from '@zipbul/common';",
      '',
      '@Injectable()',
      'export class MyService {}',
    ].join('\n');
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'MyService');

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      createDefaultContext(), createRealAstLocators(),
      createNoopMethodCallbacks(), createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;

    expect(metadata.decorators).toHaveLength(1);
    expect(metadata.decorators[0]?.name).toBe('Injectable');
  });

  it('should resolve aliased decorator to original name via currentOriginalNames', () => {
    const code = [
      "import { Injectable as Inj } from '@zipbul/common';",
      '',
      '@Inj()',
      'export class MyService {}',
    ].join('\n');
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'MyService');
    const context = createDefaultContext();

    context.currentOriginalNames = { Inj: 'Injectable' };

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      context, createRealAstLocators(),
      createNoopMethodCallbacks(), createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;

    expect(metadata.decorators[0]?.name).toBe('Injectable');
  });

  it('should populate constructorParams when class has constructor with typed parameters', () => {
    const code = [
      "import { ConfigService } from './config.service';",
      '',
      'export class MyService {',
      '  constructor(private config: ConfigService) {}',
      '}',
    ].join('\n');
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'MyService');

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      createDefaultContext(), createRealAstLocators(),
      createNoopMethodCallbacks(), createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;

    expect(metadata.constructorParams).toHaveLength(1);
    expect(metadata.constructorParams[0]?.name).toBe('config');
  });

  it('should return type as any when constructor param has no type annotation', () => {
    const code = [
      'export class MyService {',
      '  constructor(private value) {}',
      '}',
    ].join('\n');
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'MyService');

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      createDefaultContext(), createRealAstLocators(),
      createNoopMethodCallbacks(), createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;

    expect(metadata.constructorParams).toHaveLength(1);
    expect(metadata.constructorParams[0]?.type).toBe('any');
  });

  it('should extract typeArgs from generic constructor param type', () => {
    const code = [
      "import { Map } from './map';",
      '',
      'export class MyService {',
      '  constructor(private data: Map<string, number>) {}',
      '}',
    ].join('\n');
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'MyService');

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      createDefaultContext(), createRealAstLocators(),
      createNoopMethodCallbacks(), createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;

    expect(metadata.constructorParams[0]?.typeArgs).toEqual(['string', 'number']);
  });

  it('should populate methods when class has decorated method', () => {
    const code = [
      "import { Get } from '@zipbul/http-adapter';",
      '',
      'export class MyController {',
      "  @Get('/users')",
      '  getUsers() {}',
      '}',
    ].join('\n');
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'MyController');

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      createDefaultContext(), createRealAstLocators(),
      createNoopMethodCallbacks(), createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;

    expect(metadata.methods).toHaveLength(1);
    expect(metadata.methods[0]?.name).toBe('getUsers');
    expect(metadata.methods[0]?.decorators).toHaveLength(1);
    expect(metadata.methods[0]?.decorators[0]?.name).toBe('Get');
  });

  it('should populate method parameters with decorators', () => {
    const code = [
      "import { Get, Param } from '@zipbul/http-adapter';",
      '',
      'export class MyController {',
      "  @Get('/users/:id')",
      "  getUser(@Param('id') userId: string) {}",
      '}',
    ].join('\n');
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'MyController');

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      createDefaultContext(), createRealAstLocators(),
      createNoopMethodCallbacks(), createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;

    expect(metadata.methods[0]?.parameters).toHaveLength(1);
    expect(metadata.methods[0]?.parameters[0]?.name).toBe('userId');
    expect(metadata.methods[0]?.parameters[0]?.decorators).toHaveLength(1);
    expect(metadata.methods[0]?.parameters[0]?.decorators[0]?.name).toBe('Param');
  });

  it('should set isStatic for static methods', () => {
    const code = [
      "import { Get } from '@zipbul/http-adapter';",
      '',
      'export class MyController {',
      '  @Get()',
      '  static health() {}',
      '}',
    ].join('\n');
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'MyController');

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      createDefaultContext(), createRealAstLocators(),
      createNoopMethodCallbacks(), createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;

    expect(metadata.methods).toHaveLength(1);
    expect(metadata.methods[0]?.isStatic).toBe(true);
  });

  it('should extract typedCalls from decorated method body', () => {
    const code = [
      "import { Get } from '@zipbul/http-adapter';",
      '',
      'export class MyController {',
      '  @Get()',
      '  getUsers() { return []; }',
      '}',
    ].join('\n');
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'MyController');
    const methodCallbacks = createNoopMethodCallbacks();
    const typedCallResult = [{ methodName: 'getBody', typeArgs: ['UserDto'], callArgs: [] }];

    (methodCallbacks.extractTypedCalls as ReturnType<typeof mock>).mockReturnValue(typedCallResult);

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      createDefaultContext(), createRealAstLocators(),
      methodCallbacks, createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;

    expect(metadata.methods[0]?.typedCalls).toEqual(typedCallResult);
  });

  it('should populate properties when class has decorated property', () => {
    const code = [
      "import { Column } from './decorators';",
      '',
      'export class UserEntity {',
      '  @Column()',
      '  name: string;',
      '}',
    ].join('\n');
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'UserEntity');

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      createDefaultContext(), createRealAstLocators(),
      createNoopMethodCallbacks(), createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;

    expect(metadata.properties).toHaveLength(1);
    expect(metadata.properties[0]?.name).toBe('name');
    expect(metadata.properties[0]?.decorators).toHaveLength(1);
    expect(metadata.properties[0]?.decorators[0]?.name).toBe('Column');
  });

  it('should include initializer in property metadata', () => {
    const code = [
      "import { Column } from './decorators';",
      '',
      'export class Config {',
      '  @Column()',
      "  host = 'localhost';",
      '}',
    ].join('\n');
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'Config');

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      createDefaultContext(), createRealAstLocators(),
      createNoopMethodCallbacks(), createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;

    expect(metadata.properties[0]?.initializer).toBe('localhost');
  });

  it('should set isOptional for protected property', () => {
    const code = [
      "import { Column } from './decorators';",
      '',
      'export class Config {',
      '  @Column()',
      '  protected host: string;',
      '}',
    ].join('\n');
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'Config');

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      createDefaultContext(), createRealAstLocators(),
      createNoopMethodCallbacks(), createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;

    expect(metadata.properties[0]?.isOptional).toBe(true);
  });

  it('should populate heritage when class extends another', () => {
    const code = [
      "import { BaseService } from './base';",
      '',
      'export class MyService extends BaseService {}',
    ].join('\n');
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'MyService');

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      createDefaultContext(), createRealAstLocators(),
      createNoopMethodCallbacks(), createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;

    expect(metadata.heritage).toBeDefined();
    expect(metadata.heritage?.clause).toBe('extends');
    expect(metadata.heritage?.typeName).toBe('BaseService');
  });

  it('should extract heritage typeArgs for TS utility type extends', () => {
    const code = [
      'export class MyConfig extends Partial<BaseConfig> {}',
    ].join('\n');
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'MyConfig');

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      createDefaultContext(), createRealAstLocators(),
      createNoopMethodCallbacks(), createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;

    expect(metadata.heritage).toBeDefined();
    expect(metadata.heritage?.typeName).toBe('Partial');
    expect(metadata.heritage?.typeArgs).toEqual(['BaseConfig']);
  });

  it('should populate imports from currentImports', () => {
    const code = 'export class SimpleService {}';
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'SimpleService');
    const currentImports = { ConfigService: './config.service' };

    const result = convertClassSymbol(
      symbol, parsed, currentImports, importMap,
      createDefaultContext(), createRealAstLocators(),
      createNoopMethodCallbacks(), createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;

    expect(metadata.imports).toEqual({ ConfigService: './config.service' });
  });

  it('should extract middlewares from configure method', () => {
    const code = [
      "import { Module } from '@zipbul/common';",
      '',
      '@Module()',
      'export class AppModule {',
      '  configure() {}',
      '}',
    ].join('\n');
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'AppModule');
    const methodCallbacks = createNoopMethodCallbacks();
    const middlewareResult = [{ name: 'LoggerMiddleware', index: 0 }];

    (methodCallbacks.extractMiddlewaresFromConfigure as ReturnType<typeof mock>).mockReturnValue(middlewareResult);

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      createDefaultContext(), createRealAstLocators(),
      methodCallbacks, createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;

    expect(metadata.middlewares).toEqual(middlewareResult);
  });

  it('should extract exceptionFilters from configure method', () => {
    const code = [
      "import { Module } from '@zipbul/common';",
      '',
      '@Module()',
      'export class AppModule {',
      '  configure() {}',
      '}',
    ].join('\n');
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'AppModule');
    const methodCallbacks = createNoopMethodCallbacks();
    const filterResult = [{ name: 'HttpExceptionFilter', index: 0 }];

    (methodCallbacks.extractExceptionFiltersFromConfigure as ReturnType<typeof mock>).mockReturnValue(filterResult);

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      createDefaultContext(), createRealAstLocators(),
      methodCallbacks, createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;

    expect(metadata.exceptionFilters).toEqual(filterResult);
  });

  it('should resolve constructor param type with typeImportSource to ref object', () => {
    const code = [
      "import { ConfigService } from './config.service';",
      '',
      'export class MyService {',
      '  constructor(private config: ConfigService) {}',
      '}',
    ].join('\n');
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'MyService');
    const context = createDefaultContext();

    context.resolvePath = (_sourcePath: string, importPath: string) => `/resolved${importPath}`;

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      context, createRealAstLocators(),
      createNoopMethodCallbacks(), createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;
    const paramType = metadata.constructorParams[0]?.type;

    expect(typeof paramType).toBe('object');

    if (typeof paramType === 'object' && paramType !== null) {
      const record = paramType as Record<string, unknown>;

      expect(record[ZIPBUL_REF]).toBe('ConfigService');
    }
  });

  it('should return err diagnostic for anonymous class with empty name', () => {
    const code = 'export class SimpleService {}';
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol: ExtractedSymbol = { ...findClassSymbol(symbols, 'SimpleService'), name: '' };

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      createDefaultContext(), createRealAstLocators(),
      createNoopMethodCallbacks(), createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(true);

    if (isErr(result)) {
      expect(result.data.why).toMatch(/Anonymous classes/);
    }
  });

  it('should return err diagnostic when callback detects anonymous class', () => {
    const code = 'export class SimpleService {}';
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'SimpleService');
    const anonymousCheck: AnonymousClassCallback = {
      isAnonymousClassSymbol: mock(() => true),
    };

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      createDefaultContext(), createRealAstLocators(),
      createNoopMethodCallbacks(), anonymousCheck,
    );

    expect(isErr(result)).toBe(true);

    if (isErr(result)) {
      expect(result.data.why).toMatch(/Anonymous classes/);
    }
  });

  it('should include file path in anonymous class diagnostic', () => {
    const code = 'export class SimpleService {}';
    const filePath = '/app/src/broken.ts';
    const { parsed, symbols, importMap } = parseFixture(code, filePath);
    const symbol: ExtractedSymbol = { ...findClassSymbol(symbols, 'SimpleService'), name: '' };

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      createDefaultContext(filePath), createRealAstLocators(),
      createNoopMethodCallbacks(), createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(true);

    if (isErr(result)) {
      expect(result.data.where?.file).toBe(filePath);
    }
  });

  it('should skip method with empty name and no decorators', () => {
    const code = [
      'export class MyService {',
      '  doSomething() {}',
      '}',
    ].join('\n');
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'MyService');

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      createDefaultContext(), createRealAstLocators(),
      createNoopMethodCallbacks(), createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;

    expect(metadata.methods).toEqual([]);
  });

  it('should propagate middleware extraction error from configure method', () => {
    const code = [
      "import { Module } from '@zipbul/common';",
      '',
      '@Module()',
      'export class AppModule {',
      '  configure() {}',
      '}',
    ].join('\n');
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'AppModule');
    const methodCallbacks = createNoopMethodCallbacks();
    const diagnostic = buildDiagnostic({ reason: 'middleware error', file: '/app/src/test.ts' });

    (methodCallbacks.extractMiddlewaresFromConfigure as ReturnType<typeof mock>).mockReturnValue(err(diagnostic));

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      createDefaultContext(), createRealAstLocators(),
      methodCallbacks, createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(true);

    if (isErr(result)) {
      expect(result.data.why).toBe('middleware error');
    }
  });

  it('should propagate exceptionFilter extraction error from configure method', () => {
    const code = [
      "import { Module } from '@zipbul/common';",
      '',
      '@Module()',
      'export class AppModule {',
      '  configure() {}',
      '}',
    ].join('\n');
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'AppModule');
    const methodCallbacks = createNoopMethodCallbacks();
    const diagnostic = buildDiagnostic({ reason: 'filter error', file: '/app/src/test.ts' });

    (methodCallbacks.extractExceptionFiltersFromConfigure as ReturnType<typeof mock>).mockReturnValue(err(diagnostic));

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      createDefaultContext(), createRealAstLocators(),
      methodCallbacks, createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(true);

    if (isErr(result)) {
      expect(result.data.why).toBe('filter error');
    }
  });

  it('should return empty arrays when class has no members', () => {
    const code = 'export class EmptyService {}';
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'EmptyService');

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      createDefaultContext(), createRealAstLocators(),
      createNoopMethodCallbacks(), createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;

    expect(metadata.constructorParams).toEqual([]);
    expect(metadata.methods).toEqual([]);
    expect(metadata.properties).toEqual([]);
  });

  it('should handle class with empty decorators array', () => {
    const code = 'export class NoDecorators {}';
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'NoDecorators');

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      createDefaultContext(), createRealAstLocators(),
      createNoopMethodCallbacks(), createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;

    expect(metadata.decorators).toEqual([]);
  });

  it('should skip property with empty name', () => {
    const code = [
      'export class MyClass {',
      '  validProp = 42;',
      '}',
    ].join('\n');
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'MyClass');

    // Manually set a member with empty name to simulate the edge case
    const symbolWithEmptyProp: ExtractedSymbol = {
      ...symbol,
      members: [
        {
          kind: 'property',
          name: '',
          span: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
          isExported: false,
          modifiers: [],
          initializer: { kind: 'number', value: 42 },
        },
      ],
    };

    const result = convertClassSymbol(
      symbolWithEmptyProp, parsed, {}, importMap,
      createDefaultContext(), createRealAstLocators(),
      createNoopMethodCallbacks(), createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;

    expect(metadata.properties).toEqual([]);
  });

  it('should return no heritage when heritage array is empty', () => {
    const code = 'export class Standalone {}';
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'Standalone');

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      createDefaultContext(), createRealAstLocators(),
      createNoopMethodCallbacks(), createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;

    expect(metadata.heritage).toBeUndefined();
  });

  it('should generate synthetic name for computed method with decorators', () => {
    const code = [
      'export class MyClass {',
      '  doWork() {}',
      '}',
    ].join('\n');
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'MyClass');

    // Simulate computed method scenario: gildash gives name "unknown" for computed methods
    const symbolWithComputed: ExtractedSymbol = {
      ...symbol,
      members: [
        {
          kind: 'method',
          methodKind: 'method',
          name: 'unknown',
          span: { start: { line: 2, column: 2 }, end: { line: 2, column: 20 } },
          isExported: false,
          modifiers: [],
          decorators: [{ name: 'Get', arguments: [] }],
        },
      ],
    };

    const astLocators: AstNodeLocatorCallbacks = {
      ...createRealAstLocators(),
      getMethodAstMeta: mock(() => ({ isComputed: true, isPrivateName: false, start: 42 })),
    };

    const result = convertClassSymbol(
      symbolWithComputed, parsed, {}, importMap,
      createDefaultContext(), astLocators,
      createNoopMethodCallbacks(), createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;

    expect(metadata.methods).toHaveLength(1);
    expect(metadata.methods[0]?.name).toBe('__computed_42__');
    expect(metadata.methods[0]?.isComputed).toBe(true);
  });

  it('should skip computed method named unknown without decorators', () => {
    const code = [
      'export class MyClass {',
      '  doWork() {}',
      '}',
    ].join('\n');
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'MyClass');

    const symbolWithComputed: ExtractedSymbol = {
      ...symbol,
      members: [
        {
          kind: 'method',
          methodKind: 'method',
          name: 'unknown',
          span: { start: { line: 2, column: 2 }, end: { line: 2, column: 20 } },
          isExported: false,
          modifiers: [],
        },
      ],
    };

    const astLocators: AstNodeLocatorCallbacks = {
      ...createRealAstLocators(),
      getMethodAstMeta: mock(() => ({ isComputed: true, isPrivateName: false, start: 42 })),
    };

    const result = convertClassSymbol(
      symbolWithComputed, parsed, {}, importMap,
      createDefaultContext(), astLocators,
      createNoopMethodCallbacks(), createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;

    expect(metadata.methods).toEqual([]);
  });

  it('should not extract configure when rawClassNode is null', () => {
    const code = [
      "import { Module } from '@zipbul/common';",
      '',
      '@Module()',
      'export class AppModule {',
      '  configure() {}',
      '}',
    ].join('\n');
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'AppModule');
    const methodCallbacks = createNoopMethodCallbacks();
    const astLocators: AstNodeLocatorCallbacks = {
      findClassAstNode: mock(() => null),
      findMethodBodyAstNode: mock(() => null),
      findPropertyAstNode: mock(() => null),
      getMethodAstMeta: mock(() => null),
    };

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      createDefaultContext(), astLocators,
      methodCallbacks, createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;

    expect(metadata.middlewares).toEqual([]);
    expect(metadata.exceptionFilters).toEqual([]);
    expect(methodCallbacks.extractMiddlewaresFromConfigure).not.toHaveBeenCalled();
  });

  it('should extract heritage typeArgs for implements TS utility type', () => {
    const code = [
      'interface PartialConfig {}',
      'export class MyConfig implements Partial<PartialConfig> {}',
    ].join('\n');
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'MyConfig');

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      createDefaultContext(), createRealAstLocators(),
      createNoopMethodCallbacks(), createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;

    expect(metadata.heritage).toBeDefined();
    expect(metadata.heritage?.clause).toBe('implements');
    expect(metadata.heritage?.typeName).toBe('Partial');
    expect(metadata.heritage?.typeArgs).toEqual(['PartialConfig']);
  });

  it('should resolve aliased constructor param type through importMap originalName', () => {
    const code = [
      "import { OriginalService as Alias } from './service';",
      '',
      'export class MyService {',
      '  constructor(private dep: Alias) {}',
      '}',
    ].join('\n');
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'MyService');
    const context = createDefaultContext();

    context.resolvePath = (_sourcePath: string, importPath: string) => `/resolved${importPath}`;

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      context, createRealAstLocators(),
      createNoopMethodCallbacks(), createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;
    const paramType = metadata.constructorParams[0]?.type;

    expect(typeof paramType).toBe('object');

    if (typeof paramType === 'object' && paramType !== null) {
      const record = paramType as Record<string, unknown>;

      expect(record[ZIPBUL_REF]).toBe('OriginalService');
    }
  });

  it('should handle heritage with non-utility type having no typeArgs', () => {
    const code = [
      "import { BaseService } from './base';",
      '',
      'export class MyService extends BaseService {}',
    ].join('\n');
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'MyService');

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      createDefaultContext(), createRealAstLocators(),
      createNoopMethodCallbacks(), createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;

    expect(metadata.heritage?.typeArgs).toBeUndefined();
  });

  it('should use only first heritage clause when multiple are present', () => {
    const code = [
      'interface Configurable {}',
      'interface Serializable {}',
      'export class MyClass implements Configurable, Serializable {}',
    ].join('\n');
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'MyClass');

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      createDefaultContext(), createRealAstLocators(),
      createNoopMethodCallbacks(), createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;

    expect(metadata.heritage).toBeDefined();
    expect(metadata.heritage?.typeName).toBe('Configurable');
  });

  it('should resolve constructor param decorator alias through currentOriginalNames', () => {
    const code = [
      "import { Inject as Inj } from '@zipbul/common';",
      '',
      'export class MyService {',
      "  constructor(@Inj('TOKEN') private dep: string) {}",
      '}',
    ].join('\n');
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'MyService');
    const context = createDefaultContext();

    context.currentOriginalNames = { Inj: 'Inject' };

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      context, createRealAstLocators(),
      createNoopMethodCallbacks(), createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;

    expect(metadata.constructorParams[0]?.decorators[0]?.name).toBe('Inject');
  });

  it('should include methods only when they have decorators or decorated params', () => {
    const code = [
      "import { Get, Param } from '@zipbul/http-adapter';",
      '',
      'export class MyController {',
      '  @Get()',
      '  decorated() {}',
      '',
      '  noDecorators() {}',
      '',
      "  withParamDecorator(@Param('id') userId: string) {}",
      '}',
    ].join('\n');
    const { parsed, symbols, importMap } = parseFixture(code);
    const symbol = findClassSymbol(symbols, 'MyController');

    const result = convertClassSymbol(
      symbol, parsed, {}, importMap,
      createDefaultContext(), createRealAstLocators(),
      createNoopMethodCallbacks(), createDefaultAnonymousCheck(),
    );

    expect(isErr(result)).toBe(false);

    const metadata = result as ClassMetadata;
    const methodNames = metadata.methods.map(m => m.name);

    expect(methodNames).toContain('decorated');
    expect(methodNames).not.toContain('noDecorators');
    expect(methodNames).toContain('withParamDecorator');
  });
});

describe('resolveTypeArgName', () => {
  it('should return type name for TSTypeReference with Identifier', () => {
    const code = 'export class MyClass extends Partial<UserDto> {}';
    const { parsed } = parseFixture(code);
    const classNode = findClassAstNode(parsed, 'MyClass');

    expect(classNode).not.toBeNull();

    const superTypeArgs = classNode!.superTypeArguments;

    expect(superTypeArgs).not.toBeNull();

    if (superTypeArgs !== null && superTypeArgs !== undefined) {
      const firstParam = superTypeArgs.params[0];

      expect(firstParam).toBeDefined();

      const result = resolveTypeArgName(firstParam!);

      expect(result).toBe('UserDto');
    }
  });

  it('should return Unknown for non-TSTypeReference node', () => {
    const code = 'export const value = 42;';
    const { parsed } = parseFixture(code);

    // Use a numeric literal node as a non-TSTypeReference
    const stmt = parsed.program.body[0];

    expect(stmt).toBeDefined();

    // Use any non-TSTypeReference AST node
    const result = resolveTypeArgName(stmt!);

    expect(result).toBe('Unknown');
  });

  it('should return Unknown for TSTypeReference with non-Identifier typeName', () => {
    // TSQualifiedName is a non-Identifier typeName in TSTypeReference
    const code = [
      'export class MyClass extends Partial<Ns.Config> {}',
    ].join('\n');
    const { parsed } = parseFixture(code);
    const classNode = findClassAstNode(parsed, 'MyClass');

    expect(classNode).not.toBeNull();

    const superTypeArgs = classNode!.superTypeArguments;

    if (superTypeArgs !== null && superTypeArgs !== undefined) {
      const firstParam = superTypeArgs.params[0];

      expect(firstParam).toBeDefined();

      const result = resolveTypeArgName(firstParam!);

      // TSQualifiedName (Ns.Config) has typeName.type === 'TSQualifiedName', not 'Identifier'
      expect(result).toBe('Unknown');
    }
  });
});
