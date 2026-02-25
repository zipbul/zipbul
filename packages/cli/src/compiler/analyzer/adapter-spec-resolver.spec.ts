import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { join } from 'path';

import { isErr } from '@zipbul/result';
import type { FileAnalysis } from './graph/interfaces';
import type { FileSetup } from '../../../test/shared/interfaces';
import type { AstParseResult } from './test/types';
import type { AnalyzerValue, AnalyzerValueRecord } from './types';

import { createBunFileStub } from '../../../test/shared/stubs';
import { PathResolver } from '../../common';
import { AstParser } from './ast-parser';
import { AdapterSpecResolver } from './adapter-spec-resolver';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const applyParseToAnalysis = (analysis: FileAnalysis, parseResult: AstParseResult): FileAnalysis => {
  if (parseResult.imports !== undefined) {
    analysis.imports = parseResult.imports;
  }

  if (parseResult.exportedValues !== undefined && analysis.exportedValues === undefined) {
    analysis.exportedValues = parseResult.exportedValues;
  }

  if (parseResult.localValues !== undefined) {
    analysis.localValues = parseResult.localValues;
  }

  if (parseResult.moduleDefinition !== undefined) {
    analysis.moduleDefinition = parseResult.moduleDefinition;
  }

  return analysis;
};

/**
 * Create a standard adapter object literal value as AstParser would evaluate it.
 * Each field mirrors AdapterRegistrationInput after AstParser.parseExpression().
 */
const createAdapterValue = (overrides?: Partial<Record<string, AnalyzerValue>>): AnalyzerValueRecord => ({
  name: 'test',
  classRef: { __zipbul_ref: 'TestAdapter' },
  pipeline: ['Before', 'Guards', 'Pipes', 'Handler'],
  decorators: {
    controller: { __zipbul_ref: 'Controller' },
    handler: [{ __zipbul_ref: 'Get' }],
  },
  ...overrides,
});

const wrapDefineAdapter = (...args: AnalyzerValue[]): AnalyzerValueRecord => ({
  __zipbul_call: 'defineAdapter',
  args,
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('AdapterSpecResolver', () => {
  const projectRoot = '/project';
  const srcDir = join(projectRoot, 'src');
  const adapterDir = join(projectRoot, 'adapters', 'test-adapter');
  const controllerFile = join(srcDir, 'controllers.ts');
  const entryFile = join(adapterDir, 'index.ts');
  let setup: FileSetup;
  let bunFileSpy: ReturnType<typeof spyOn> | undefined;

  beforeEach(() => {
    setup = {
      existsByPath: new Map<string, boolean>(),
      textByPath: new Map<string, string>(),
    };

    bunFileSpy = spyOn(Bun, 'file').mockImplementation(((path: string) => {
      return createBunFileStub(setup, path) as any;
    }) as typeof Bun.file);
  });

  afterEach(() => {
    bunFileSpy?.mockRestore();
  });

  // -----------------------------------------------------------------------
  // Factory: build a basic fileMap with an adapter entry + controller file
  // -----------------------------------------------------------------------

  const controllerCode = [
    'function Controller() { return () => {}; }',
    'function Get() { return () => {}; }',
    'function Middlewares() { return () => {}; }',
    'function mwOne() {}',
    '',
    '@Controller()',
    'class SampleController {',
    '  @Get()',
    '  handle() {}',
    '}',
  ].join('\n');

  const buildStandardFileMap = (
    adapterValue: AnalyzerValueRecord = createAdapterValue(),
  ): Map<string, FileAnalysis> => {
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();

    // Controller file
    const controllerParse = parser.parse(controllerFile, controllerCode);
    const controllerAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: controllerParse.classes,
      reExports: controllerParse.reExports,
      exports: controllerParse.exports,
      importEntries: [{ source: '@test/adapter', resolvedSource: entryFile, isRelative: false }],
    };

    applyParseToAnalysis(controllerAnalysis, controllerParse);
    fileMap.set(controllerFile, controllerAnalysis);

    // Entry file (adapter)
    const entryParse = parser.parse(entryFile, 'export const adapterSpec = defineAdapter({});');
    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: entryParse.classes,
      reExports: entryParse.reExports,
      exports: entryParse.exports,
      exportedValues: { adapterSpec: wrapDefineAdapter(adapterValue) },
    };

    applyParseToAnalysis(entryAnalysis, entryParse);
    fileMap.set(entryFile, entryAnalysis);

    return fileMap;
  };

  // =======================================================================
  // Happy Path (HP)
  // =======================================================================

  it('should resolve adapter with object literal containing all required fields', async () => {
    // Arrange
    const fileMap = buildStandardFileMap();
    const resolver = new AdapterSpecResolver();

    // Act
    const result = await resolver.resolve({ fileMap, projectRoot });

    // Assert
    expect(Object.keys(result.adapterStaticSpecs)).toEqual(['test']);

    const spec = result.adapterStaticSpecs.test;

    expect(spec?.pipeline).toEqual(['Before', 'Guards', 'Pipes', 'Handler']);
    expect(spec?.entryDecorators).toEqual({ controller: 'Controller', handler: ['Get'] });
  });

  it('should resolve multiple adapters from different entry files', async () => {
    // Arrange
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();
    const entryA = join(projectRoot, 'adapters', 'a', 'index.ts');
    const entryB = join(projectRoot, 'adapters', 'b', 'index.ts');

    // Controller that imports both
    const controllerParse = parser.parse(controllerFile, controllerCode);
    const controllerAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: controllerParse.classes,
      reExports: controllerParse.reExports,
      exports: controllerParse.exports,
      importEntries: [
        { source: '@test/a', resolvedSource: entryA, isRelative: false },
      ],
    };

    applyParseToAnalysis(controllerAnalysis, controllerParse);
    fileMap.set(controllerFile, controllerAnalysis);

    // Second controller file for adapter 'b'
    const controllerFileB = join(srcDir, 'ws-controllers.ts');
    const controllerCodeB = [
      'function WsGateway() { return () => {}; }',
      'function OnMessage() { return () => {}; }',
      '',
      '@WsGateway()',
      'class ChatGateway {',
      '  @OnMessage()',
      '  onChat() {}',
      '}',
    ].join('\n');
    const controllerParseB = parser.parse(controllerFileB, controllerCodeB);
    const controllerAnalysisB: FileAnalysis = {
      filePath: controllerFileB,
      classes: controllerParseB.classes,
      reExports: controllerParseB.reExports,
      exports: controllerParseB.exports,
      importEntries: [
        { source: '@test/b', resolvedSource: entryB, isRelative: false },
      ],
    };

    applyParseToAnalysis(controllerAnalysisB, controllerParseB);
    fileMap.set(controllerFileB, controllerAnalysisB);

    // Adapter A entry
    const adapterAValue = createAdapterValue({ name: 'alpha' });
    const entryParseA = parser.parse(entryA, 'export const adapterSpec = defineAdapter({});');
    const entryAnalysisA: FileAnalysis = {
      filePath: entryA,
      classes: entryParseA.classes,
      reExports: entryParseA.reExports,
      exports: entryParseA.exports,
      exportedValues: { adapterSpec: wrapDefineAdapter(adapterAValue) },
    };

    applyParseToAnalysis(entryAnalysisA, entryParseA);
    fileMap.set(entryA, entryAnalysisA);

    // Adapter B entry
    const adapterBValue = createAdapterValue({
      name: 'beta',
      decorators: {
        controller: { __zipbul_ref: 'WsGateway' },
        handler: [{ __zipbul_ref: 'OnMessage' }],
      },
    });
    const entryParseB = parser.parse(entryB, 'export const adapterSpec = defineAdapter({});');
    const entryAnalysisB: FileAnalysis = {
      filePath: entryB,
      classes: entryParseB.classes,
      reExports: entryParseB.reExports,
      exports: entryParseB.exports,
      exportedValues: { adapterSpec: wrapDefineAdapter(adapterBValue) },
    };

    applyParseToAnalysis(entryAnalysisB, entryParseB);
    fileMap.set(entryB, entryAnalysisB);

    const resolver = new AdapterSpecResolver();

    // Act
    const result = await resolver.resolve({ fileMap, projectRoot });

    // Assert
    expect(Object.keys(result.adapterStaticSpecs)).toEqual(['alpha', 'beta']);
  });

  it('should resolve adapterSpec via re-export barrel (export all)', async () => {
    // Arrange
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();
    const barrelFile = join(adapterDir, 'index.ts');
    const specFile = join(adapterDir, 'spec.ts');

    // Controller imports barrel
    const controllerParse = parser.parse(controllerFile, controllerCode);
    const controllerAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: controllerParse.classes,
      reExports: controllerParse.reExports,
      exports: controllerParse.exports,
      importEntries: [{ source: '@test/adapter', resolvedSource: barrelFile, isRelative: false }],
    };

    applyParseToAnalysis(controllerAnalysis, controllerParse);
    fileMap.set(controllerFile, controllerAnalysis);

    // Barrel re-exports all from spec file
    const barrelAnalysis: FileAnalysis = {
      filePath: barrelFile,
      classes: [],
      reExports: [{ module: specFile, exportAll: true }],
      exports: [],
    };

    fileMap.set(barrelFile, barrelAnalysis);

    // Spec file has actual adapterSpec
    const specAnalysis: FileAnalysis = {
      filePath: specFile,
      classes: [],
      reExports: [],
      exports: ['adapterSpec'],
      exportedValues: { adapterSpec: wrapDefineAdapter(createAdapterValue()) },
    };

    fileMap.set(specFile, specAnalysis);

    const resolver = new AdapterSpecResolver();

    // Act
    const result = await resolver.resolve({ fileMap, projectRoot });

    // Assert
    expect(Object.keys(result.adapterStaticSpecs)).toEqual(['test']);
  });

  it('should resolve adapterSpec via named re-export', async () => {
    // Arrange
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();
    const barrelFile = join(adapterDir, 'index.ts');
    const specFile = join(adapterDir, 'spec.ts');

    const controllerParse = parser.parse(controllerFile, controllerCode);
    const controllerAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: controllerParse.classes,
      reExports: controllerParse.reExports,
      exports: controllerParse.exports,
      importEntries: [{ source: '@test/adapter', resolvedSource: barrelFile, isRelative: false }],
    };

    applyParseToAnalysis(controllerAnalysis, controllerParse);
    fileMap.set(controllerFile, controllerAnalysis);

    const barrelAnalysis: FileAnalysis = {
      filePath: barrelFile,
      classes: [],
      reExports: [{ module: specFile, names: [{ local: 'adapterSpec', exported: 'adapterSpec' }] }],
      exports: [],
    };

    fileMap.set(barrelFile, barrelAnalysis);

    const specAnalysis: FileAnalysis = {
      filePath: specFile,
      classes: [],
      reExports: [],
      exports: ['adapterSpec'],
      exportedValues: { adapterSpec: wrapDefineAdapter(createAdapterValue()) },
    };

    fileMap.set(specFile, specAnalysis);

    const resolver = new AdapterSpecResolver();

    // Act
    const result = await resolver.resolve({ fileMap, projectRoot });

    // Assert
    expect(Object.keys(result.adapterStaticSpecs)).toEqual(['test']);
  });

  it('should build handlerIndex with correct id format', async () => {
    // Arrange
    const fileMap = buildStandardFileMap();
    const resolver = new AdapterSpecResolver();

    // Act
    const result = await resolver.resolve({ fileMap, projectRoot });

    // Assert
    const expectedFile = PathResolver.normalize('src/controllers.ts');
    const expectedId = `test:${expectedFile}#SampleController.handle`;

    expect(result.handlerIndex.map(e => e.id)).toEqual([expectedId]);
  });

  it('should collect middleware phase ids from module config', async () => {
    // Arrange
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();

    const moduleFile = join(srcDir, 'app.module.ts');
    const moduleCode = [
      "import { defineModule } from '@zipbul/common';",
      '',
      'export default defineModule({',
      "  name: 'app',",
      '  adapters: {',
      '    test: {',
      '      middlewares: {',
      '        Before: [],',
      '      },',
      '    },',
      '  },',
      '});',
    ].join('\n');

    const moduleParse = parser.parse(moduleFile, moduleCode);
    const moduleAnalysis: FileAnalysis = {
      filePath: moduleFile,
      classes: moduleParse.classes,
      reExports: moduleParse.reExports,
      exports: moduleParse.exports,
      importEntries: [{ source: '@test/adapter', resolvedSource: entryFile, isRelative: false }],
    };

    applyParseToAnalysis(moduleAnalysis, moduleParse);
    fileMap.set(moduleFile, moduleAnalysis);

    // Controller
    const controllerParse = parser.parse(controllerFile, controllerCode);
    const controllerAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: controllerParse.classes,
      reExports: controllerParse.reExports,
      exports: controllerParse.exports,
    };

    applyParseToAnalysis(controllerAnalysis, controllerParse);
    fileMap.set(controllerFile, controllerAnalysis);

    // Entry file
    const entryParse = parser.parse(entryFile, 'export const adapterSpec = defineAdapter({});');
    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: entryParse.classes,
      reExports: entryParse.reExports,
      exports: entryParse.exports,
      exportedValues: { adapterSpec: wrapDefineAdapter(createAdapterValue()) },
    };

    applyParseToAnalysis(entryAnalysis, entryParse);
    fileMap.set(entryFile, entryAnalysis);

    const resolver = new AdapterSpecResolver();

    // Act & Assert — should not throw (module middleware phase 'Before' is supported)
    const result = await resolver.resolve({ fileMap, projectRoot });

    expect(Object.keys(result.adapterStaticSpecs)).toEqual(['test']);
  });

  it('should collect middleware phase ids from @Middlewares decorator (string form)', async () => {
    // Arrange
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();

    const code = [
      'function Controller() { return () => {}; }',
      'function Get() { return () => {}; }',
      'function Middlewares() { return () => {}; }',
      'function mwOne() {}',
      '',
      '@Controller()',
      'class SampleController {',
      '  @Get()',
      "  @Middlewares('Before', [mwOne])",
      '  handle() {}',
      '}',
    ].join('\n');

    const controllerParse = parser.parse(controllerFile, code);
    const controllerAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: controllerParse.classes,
      reExports: controllerParse.reExports,
      exports: controllerParse.exports,
      importEntries: [{ source: '@test/adapter', resolvedSource: entryFile, isRelative: false }],
    };

    applyParseToAnalysis(controllerAnalysis, controllerParse);
    fileMap.set(controllerFile, controllerAnalysis);

    const entryParse = parser.parse(entryFile, 'export const adapterSpec = defineAdapter({});');
    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: entryParse.classes,
      reExports: entryParse.reExports,
      exports: entryParse.exports,
      exportedValues: { adapterSpec: wrapDefineAdapter(createAdapterValue()) },
    };

    applyParseToAnalysis(entryAnalysis, entryParse);
    fileMap.set(entryFile, entryAnalysis);

    const resolver = new AdapterSpecResolver();

    // Act & Assert
    const result = await resolver.resolve({ fileMap, projectRoot });

    expect(result.handlerIndex.length).toBe(1);
  });

  it('should collect middleware phase ids from @Middlewares decorator (map form)', async () => {
    // Arrange
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();

    const code = [
      'function Controller() { return () => {}; }',
      'function Get() { return () => {}; }',
      'function Middlewares() { return () => {}; }',
      'function mwOne() {}',
      '',
      '@Controller()',
      'class SampleController {',
      '  @Get()',
      '  @Middlewares({ Before: [mwOne] })',
      '  handle() {}',
      '}',
    ].join('\n');

    const controllerParse = parser.parse(controllerFile, code);
    const controllerAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: controllerParse.classes,
      reExports: controllerParse.reExports,
      exports: controllerParse.exports,
      importEntries: [{ source: '@test/adapter', resolvedSource: entryFile, isRelative: false }],
    };

    applyParseToAnalysis(controllerAnalysis, controllerParse);
    fileMap.set(controllerFile, controllerAnalysis);

    const entryParse = parser.parse(entryFile, 'export const adapterSpec = defineAdapter({});');
    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: entryParse.classes,
      reExports: entryParse.reExports,
      exports: entryParse.exports,
      exportedValues: { adapterSpec: wrapDefineAdapter(createAdapterValue()) },
    };

    applyParseToAnalysis(entryAnalysis, entryParse);
    fileMap.set(entryFile, entryAnalysis);

    const resolver = new AdapterSpecResolver();

    // Act & Assert
    const result = await resolver.resolve({ fileMap, projectRoot });

    expect(result.handlerIndex.length).toBe(1);
  });

  it('should parse pipeline with custom phases and reserved tokens', async () => {
    // Arrange
    const adapterValue = createAdapterValue({
      pipeline: ['Init', 'Guards', 'Transform', 'Pipes', 'Handler', 'Finalize'],
    });
    const fileMap = buildStandardFileMap(adapterValue);
    const resolver = new AdapterSpecResolver();

    // Act
    const result = await resolver.resolve({ fileMap, projectRoot });

    // Assert
    const spec = result.adapterStaticSpecs.test;

    expect(spec?.pipeline).toEqual(['Init', 'Guards', 'Transform', 'Pipes', 'Handler', 'Finalize']);
  });

  it('should resolve pipeline enum refs to their string values', async () => {
    // Arrange — pipeline contains __zipbul_ref objects for reserved tokens
    const adapterValue = createAdapterValue({
      pipeline: [
        'Before',
        { __zipbul_ref: 'ReservedPipeline.Guards' },
        { __zipbul_ref: 'ReservedPipeline.Pipes' },
        { __zipbul_ref: 'ReservedPipeline.Handler' },
      ],
    });
    const fileMap = buildStandardFileMap(adapterValue);
    const resolver = new AdapterSpecResolver();

    // Act
    const result = await resolver.resolve({ fileMap, projectRoot });

    // Assert
    const spec = result.adapterStaticSpecs.test;

    expect(spec?.pipeline).toEqual(['Before', 'Guards', 'Pipes', 'Handler']);
  });

  // =======================================================================
  // Negative / Error (NE)
  // =======================================================================

  it('should throw when adapterSpec is not defineAdapter call', async () => {
    // Arrange
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();

    const controllerParse = parser.parse(controllerFile, controllerCode);
    const controllerAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: controllerParse.classes,
      reExports: controllerParse.reExports,
      exports: controllerParse.exports,
      importEntries: [{ source: '@test/adapter', resolvedSource: entryFile, isRelative: false }],
    };

    applyParseToAnalysis(controllerAnalysis, controllerParse);
    fileMap.set(controllerFile, controllerAnalysis);

    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: [],
      reExports: [],
      exports: ['adapterSpec'],
      exportedValues: { adapterSpec: { __zipbul_call: 'someOtherFn', args: [] } },
    };

    fileMap.set(entryFile, entryAnalysis);

    const resolver = new AdapterSpecResolver();

    // Act & Assert
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/adapterSpec must be defineAdapter/);
    }
  });

  it('should throw when defineAdapter has wrong argument count', async () => {
    // Arrange
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();

    const controllerParse = parser.parse(controllerFile, controllerCode);
    const controllerAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: controllerParse.classes,
      reExports: controllerParse.reExports,
      exports: controllerParse.exports,
      importEntries: [{ source: '@test/adapter', resolvedSource: entryFile, isRelative: false }],
    };

    applyParseToAnalysis(controllerAnalysis, controllerParse);
    fileMap.set(controllerFile, controllerAnalysis);

    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: [],
      reExports: [],
      exports: ['adapterSpec'],
      exportedValues: { adapterSpec: wrapDefineAdapter('a', 'b') },
    };

    fileMap.set(entryFile, entryAnalysis);

    const resolver = new AdapterSpecResolver();

    // Act & Assert
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/exactly one argument/);
    }
  });

  it('should throw when defineAdapter argument is not object literal', async () => {
    // Arrange
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();

    const controllerParse = parser.parse(controllerFile, controllerCode);
    const controllerAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: controllerParse.classes,
      reExports: controllerParse.reExports,
      exports: controllerParse.exports,
      importEntries: [{ source: '@test/adapter', resolvedSource: entryFile, isRelative: false }],
    };

    applyParseToAnalysis(controllerAnalysis, controllerParse);
    fileMap.set(controllerFile, controllerAnalysis);

    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: [],
      reExports: [],
      exports: ['adapterSpec'],
      exportedValues: { adapterSpec: wrapDefineAdapter('not-an-object') },
    };

    fileMap.set(entryFile, entryAnalysis);

    const resolver = new AdapterSpecResolver();

    // Act & Assert
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/object literal/);
    }
  });

  it('should throw when name is missing or empty', async () => {
    // Arrange — missing name
    const fileMap1 = buildStandardFileMap(createAdapterValue({ name: undefined }));
    const resolver = new AdapterSpecResolver();

    const result1 = await resolver.resolve({ fileMap: fileMap1, projectRoot });
    expect(isErr(result1)).toBe(true);
    if (isErr(result1)) {
      expect(result1.data.why).toMatch(/name/);
    }

    // Arrange — empty name
    const fileMap2 = buildStandardFileMap(createAdapterValue({ name: '' }));

    const result2 = await resolver.resolve({ fileMap: fileMap2, projectRoot });
    expect(isErr(result2)).toBe(true);
    if (isErr(result2)) {
      expect(result2.data.why).toMatch(/name/);
    }
  });

  it('should throw when pipeline is missing or not array', async () => {
    // Arrange — missing
    const fileMap1 = buildStandardFileMap(createAdapterValue({ pipeline: undefined }));
    const resolver = new AdapterSpecResolver();

    const result1 = await resolver.resolve({ fileMap: fileMap1, projectRoot });
    expect(isErr(result1)).toBe(true);
    if (isErr(result1)) {
      expect(result1.data.why).toMatch(/pipeline/);
    }

    // Arrange — not array
    const fileMap2 = buildStandardFileMap(createAdapterValue({ pipeline: 'not-array' }));

    const result2 = await resolver.resolve({ fileMap: fileMap2, projectRoot });
    expect(isErr(result2)).toBe(true);
    if (isErr(result2)) {
      expect(result2.data.why).toMatch(/pipeline/);
    }
  });

  it('should throw when pipeline element is not string', async () => {
    // Arrange
    const fileMap = buildStandardFileMap(createAdapterValue({ pipeline: [123, 'Guards', 'Pipes', 'Handler'] }));
    const resolver = new AdapterSpecResolver();

    // Act & Assert
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/pipeline/);
    }
  });

  it('should throw when decorators.controller is not an array or identifier', async () => {
    // Arrange
    const fileMap = buildStandardFileMap(
      createAdapterValue({
        decorators: {
          controller: 'plain-string',
          handler: [{ __zipbul_ref: 'Get' }],
        },
      }),
    );
    const resolver = new AdapterSpecResolver();

    // Act & Assert
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/controller/);
    }
  });

  it('should throw when decorators.handler is empty or invalid', async () => {
    // Arrange — empty handler array
    const fileMap1 = buildStandardFileMap(
      createAdapterValue({
        decorators: {
          controller: { __zipbul_ref: 'Controller' },
          handler: [],
        },
      }),
    );
    const resolver = new AdapterSpecResolver();

    const result1 = await resolver.resolve({ fileMap: fileMap1, projectRoot });
    expect(isErr(result1)).toBe(true);
    if (isErr(result1)) {
      expect(result1.data.why).toMatch(/handler/);
    }

    // Arrange — handler element not identifier
    const fileMap2 = buildStandardFileMap(
      createAdapterValue({
        decorators: {
          controller: { __zipbul_ref: 'Controller' },
          handler: ['plain-string'],
        },
      }),
    );

    const result2 = await resolver.resolve({ fileMap: fileMap2, projectRoot });
    expect(isErr(result2)).toBe(true);
    if (isErr(result2)) {
      expect(result2.data.why).toMatch(/handler/);
    }
  });

  it('should throw when no adapterSpec found', async () => {
    // Arrange
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();
    const controllerParse = parser.parse(controllerFile, 'class Empty {}');
    const controllerAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: controllerParse.classes,
      reExports: controllerParse.reExports,
      exports: controllerParse.exports,
      importEntries: [{ source: '@test/adapter', resolvedSource: entryFile, isRelative: false }],
    };

    applyParseToAnalysis(controllerAnalysis, controllerParse);
    fileMap.set(controllerFile, controllerAnalysis);

    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: [],
      reExports: [],
      exports: [],
      exportedValues: { notAdapterSpec: 123 } as any,
    };

    fileMap.set(entryFile, entryAnalysis);

    const resolver = new AdapterSpecResolver();

    // Act & Assert
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/No adapterSpec exports found/);
    }
  });

  it('should throw on duplicate adapterId', async () => {
    // Arrange
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();
    const entryA = join(projectRoot, 'adapters', 'a', 'index.ts');
    const entryB = join(projectRoot, 'adapters', 'b', 'index.ts');

    const controllerParse = parser.parse(controllerFile, controllerCode);
    const controllerAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: controllerParse.classes,
      reExports: controllerParse.reExports,
      exports: controllerParse.exports,
      importEntries: [
        { source: '@test/a', resolvedSource: entryA, isRelative: false },
        { source: '@test/b', resolvedSource: entryB, isRelative: false },
      ],
    };

    applyParseToAnalysis(controllerAnalysis, controllerParse);
    fileMap.set(controllerFile, controllerAnalysis);

    // Both adapters use same name 'test'
    for (const ep of [entryA, entryB]) {
      const parse = parser.parse(ep, 'export const adapterSpec = defineAdapter({});');
      const analysis: FileAnalysis = {
        filePath: ep,
        classes: parse.classes,
        reExports: parse.reExports,
        exports: parse.exports,
        exportedValues: { adapterSpec: wrapDefineAdapter(createAdapterValue()) },
      };

      applyParseToAnalysis(analysis, parse);
      fileMap.set(ep, analysis);
    }

    const resolver = new AdapterSpecResolver();

    // Act & Assert
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/Duplicate adapterId/);
    }
  });

  it('should throw when controller has multiple adapter owners', async () => {
    // Arrange
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();
    const entryA = join(projectRoot, 'adapters', 'a', 'index.ts');
    const entryB = join(projectRoot, 'adapters', 'b', 'index.ts');

    // Controller uses BOTH adapter decorators
    const code = [
      'function Controller() { return () => {}; }',
      'function WsGateway() { return () => {}; }',
      'function Get() { return () => {}; }',
      '',
      '@Controller()',
      '@WsGateway()',
      'class DualController {',
      '  @Get()',
      '  handle() {}',
      '}',
    ].join('\n');

    const controllerParse = parser.parse(controllerFile, code);
    const controllerAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: controllerParse.classes,
      reExports: controllerParse.reExports,
      exports: controllerParse.exports,
      importEntries: [
        { source: '@test/a', resolvedSource: entryA, isRelative: false },
        { source: '@test/b', resolvedSource: entryB, isRelative: false },
      ],
    };

    applyParseToAnalysis(controllerAnalysis, controllerParse);
    fileMap.set(controllerFile, controllerAnalysis);

    const adapterAValue = createAdapterValue({ name: 'alpha' });
    const adapterBValue = createAdapterValue({
      name: 'beta',
      decorators: {
        controller: { __zipbul_ref: 'WsGateway' },
        handler: [{ __zipbul_ref: 'OnMessage' }],
      },
    });

    for (const [ep, val] of [
      [entryA, adapterAValue],
      [entryB, adapterBValue],
    ] as const) {
      const parse = parser.parse(ep as string, 'export const adapterSpec = defineAdapter({});');
      const analysis: FileAnalysis = {
        filePath: ep as string,
        classes: parse.classes,
        reExports: parse.reExports,
        exports: parse.exports,
        exportedValues: { adapterSpec: wrapDefineAdapter(val) },
      };

      applyParseToAnalysis(analysis, parse);
      fileMap.set(ep as string, analysis);
    }

    const resolver = new AdapterSpecResolver();

    // Act & Assert
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/multiple adapter owner/);
    }
  });

  it('should throw when handler not on adapter controller', async () => {
    // Arrange — handler decorator present but controller decorator doesn't match adapter
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();

    const code = [
      'function Get() { return () => {}; }',
      '',
      'class NoControllerDec {',
      '  @Get()',
      '  handle() {}',
      '}',
    ].join('\n');

    const controllerParse = parser.parse(controllerFile, code);
    const controllerAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: controllerParse.classes,
      reExports: controllerParse.reExports,
      exports: controllerParse.exports,
      importEntries: [{ source: '@test/adapter', resolvedSource: entryFile, isRelative: false }],
    };

    applyParseToAnalysis(controllerAnalysis, controllerParse);
    fileMap.set(controllerFile, controllerAnalysis);

    const entryParse = parser.parse(entryFile, 'export const adapterSpec = defineAdapter({});');
    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: entryParse.classes,
      reExports: entryParse.reExports,
      exports: entryParse.exports,
      exportedValues: { adapterSpec: wrapDefineAdapter(createAdapterValue()) },
    };

    applyParseToAnalysis(entryAnalysis, entryParse);
    fileMap.set(entryFile, entryAnalysis);

    const resolver = new AdapterSpecResolver();

    // Act & Assert — validateMiddlewarePhaseInputs fires before buildHandlerIndex
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/must belong to/);
    }
  });

  it('should throw on duplicate handler id', async () => {
    // Arrange — manually construct a class with duplicate method entries (simulates pathological input)
    const fileMap = new Map<string, FileAnalysis>();

    const controllerAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: [
        {
          className: 'SampleController',
          decorators: [{ name: 'Controller', arguments: [] }],
          methods: [
            { name: 'handle', decorators: [{ name: 'Get', arguments: [] }] },
            { name: 'handle', decorators: [{ name: 'Get', arguments: [] }] },
          ],
        },
      ],
      reExports: [],
      exports: [],
      importEntries: [{ source: '@test/adapter', resolvedSource: entryFile, isRelative: false }],
    };

    fileMap.set(controllerFile, controllerAnalysis);

    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: [],
      reExports: [],
      exports: ['adapterSpec'],
      exportedValues: { adapterSpec: wrapDefineAdapter(createAdapterValue()) },
    };

    fileMap.set(entryFile, entryAnalysis);

    const resolver = new AdapterSpecResolver();

    // Act & Assert
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/Duplicate handler id/);
    }
  });

  it('should throw when middleware phase is unsupported', async () => {
    // Arrange — @Middlewares uses phase 'Unknown' which is not supported
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();

    const code = [
      'function Controller() { return () => {}; }',
      'function Get() { return () => {}; }',
      'function Middlewares() { return () => {}; }',
      'function mwOne() {}',
      '',
      '@Controller()',
      'class SampleController {',
      '  @Get()',
      "  @Middlewares('Unknown', [mwOne])",
      '  handle() {}',
      '}',
    ].join('\n');

    const controllerParse = parser.parse(controllerFile, code);
    const controllerAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: controllerParse.classes,
      reExports: controllerParse.reExports,
      exports: controllerParse.exports,
      importEntries: [{ source: '@test/adapter', resolvedSource: entryFile, isRelative: false }],
    };

    applyParseToAnalysis(controllerAnalysis, controllerParse);
    fileMap.set(controllerFile, controllerAnalysis);

    const entryParse = parser.parse(entryFile, 'export const adapterSpec = defineAdapter({});');
    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: entryParse.classes,
      reExports: entryParse.reExports,
      exports: entryParse.exports,
      exportedValues: { adapterSpec: wrapDefineAdapter(createAdapterValue()) },
    };

    applyParseToAnalysis(entryAnalysis, entryParse);
    fileMap.set(entryFile, entryAnalysis);

    const resolver = new AdapterSpecResolver();

    // Act & Assert
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/Unsupported middleware phase/);
    }
  });

  it('should throw when pipeline missing required reserved tokens', async () => {
    // Arrange — pipeline missing 'Handler'
    const fileMap = buildStandardFileMap(
      createAdapterValue({
        pipeline: ['Before', 'Guards', 'Pipes'],
      }),
    );
    const resolver = new AdapterSpecResolver();

    // Act & Assert
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/pipeline/i);
    }
  });

  it('should throw when pipeline contains duplicate custom phase', async () => {
    // Arrange — pipeline has 'Before' twice
    const fileMap = buildStandardFileMap(
      createAdapterValue({
        pipeline: ['Before', 'Before', 'Guards', 'Pipes', 'Handler'],
      }),
    );
    const resolver = new AdapterSpecResolver();

    // Act & Assert
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/duplicate/i);
    }
  });

  it('should throw when phase id contains colon', async () => {
    // Arrange
    const fileMap = buildStandardFileMap(
      createAdapterValue({
        pipeline: ['Be:fore', 'Guards', 'Pipes', 'Handler'],
      }),
    );
    const resolver = new AdapterSpecResolver();

    // Act & Assert
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/must not contain/);
    }
  });

  // =======================================================================
  // Edge (ED)
  // =======================================================================

  it('should return no handlers when fileMap has no classes', async () => {
    // Arrange — entry file present but no controller classes
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();

    const noClassCode = 'export const nothing = 1;';
    const noClassParse = parser.parse(controllerFile, noClassCode);
    const noClassAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: noClassParse.classes,
      reExports: noClassParse.reExports,
      exports: noClassParse.exports,
      importEntries: [{ source: '@test/adapter', resolvedSource: entryFile, isRelative: false }],
    };

    applyParseToAnalysis(noClassAnalysis, noClassParse);
    fileMap.set(controllerFile, noClassAnalysis);

    const entryParse = parser.parse(entryFile, 'export const adapterSpec = defineAdapter({});');
    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: entryParse.classes,
      reExports: entryParse.reExports,
      exports: entryParse.exports,
      exportedValues: { adapterSpec: wrapDefineAdapter(createAdapterValue()) },
    };

    applyParseToAnalysis(entryAnalysis, entryParse);
    fileMap.set(entryFile, entryAnalysis);

    const resolver = new AdapterSpecResolver();

    // Act
    const result = await resolver.resolve({ fileMap, projectRoot });

    // Assert
    expect(result.handlerIndex).toEqual([]);
    expect(Object.keys(result.adapterStaticSpecs)).toEqual(['test']);
  });

  it('should handle file not found on disk when resolving entry', async () => {
    // Arrange — entry file not in fileMap AND not on disk
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();

    const nonExistentEntry = join(projectRoot, 'nonexistent', 'index.ts');

    const controllerParse = parser.parse(controllerFile, controllerCode);
    const controllerAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: controllerParse.classes,
      reExports: controllerParse.reExports,
      exports: controllerParse.exports,
      importEntries: [{ source: '@test/missing', resolvedSource: nonExistentEntry, isRelative: false }],
    };

    applyParseToAnalysis(controllerAnalysis, controllerParse);
    fileMap.set(controllerFile, controllerAnalysis);

    setup.existsByPath.set(nonExistentEntry, false);

    const resolver = new AdapterSpecResolver();

    // Act & Assert — no adapterSpec found since file doesn't exist
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/No adapterSpec exports found/);
    }
  });

  it('should handle entry file path normalization (non-.ts ignored)', async () => {
    // Arrange — import resolves to non-.ts path → ignored by collectPackageEntryFiles
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();

    const controllerParse = parser.parse(controllerFile, controllerCode);
    const controllerAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: controllerParse.classes,
      reExports: controllerParse.reExports,
      exports: controllerParse.exports,
      importEntries: [
        { source: '@test/adapter', resolvedSource: '/some/path/index.js', isRelative: false },
      ],
    };

    applyParseToAnalysis(controllerAnalysis, controllerParse);
    fileMap.set(controllerFile, controllerAnalysis);

    const resolver = new AdapterSpecResolver();

    // Act & Assert — no .ts entry → no adapterSpec found
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/No adapterSpec exports found/);
    }
  });

  it('should handle pipeline with exactly reserved tokens only', async () => {
    // Arrange — pipeline = ['Guards', 'Pipes', 'Handler'], no custom phases
    const adapterValue = createAdapterValue({
      pipeline: ['Guards', 'Pipes', 'Handler'],
    });
    const fileMap = buildStandardFileMap(adapterValue);
    const resolver = new AdapterSpecResolver();

    // Act
    const result = await resolver.resolve({ fileMap, projectRoot });

    // Assert
    expect(result.adapterStaticSpecs.test?.pipeline).toEqual(['Guards', 'Pipes', 'Handler']);
  });

  // =======================================================================
  // Corner (CO)
  // =======================================================================

  it('should break cycle in re-export chain via visited set', async () => {
    // Arrange — barrel A re-exports from B, B re-exports from A → cycle
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();
    const fileA = join(adapterDir, 'a.ts');
    const fileB = join(adapterDir, 'b.ts');

    const controllerParse = parser.parse(controllerFile, controllerCode);
    const controllerAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: controllerParse.classes,
      reExports: controllerParse.reExports,
      exports: controllerParse.exports,
      importEntries: [{ source: '@test/adapter', resolvedSource: fileA, isRelative: false }],
    };

    applyParseToAnalysis(controllerAnalysis, controllerParse);
    fileMap.set(controllerFile, controllerAnalysis);

    const analysisA: FileAnalysis = {
      filePath: fileA,
      classes: [],
      reExports: [{ module: fileB, exportAll: true }],
      exports: [],
    };

    fileMap.set(fileA, analysisA);

    const analysisB: FileAnalysis = {
      filePath: fileB,
      classes: [],
      reExports: [{ module: fileA, exportAll: true }],
      exports: [],
    };

    fileMap.set(fileB, analysisB);

    const resolver = new AdapterSpecResolver();

    // Act & Assert — should not stack overflow, instead throws "No adapterSpec"
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/No adapterSpec exports found/);
    }
  });

  it('should throw duplicate adapterId before reaching validation', async () => {
    // Arrange — two adapters with same id but different phase configs
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();
    const entryA = join(projectRoot, 'adapters', 'a', 'index.ts');
    const entryB = join(projectRoot, 'adapters', 'b', 'index.ts');

    const controllerParse = parser.parse(controllerFile, controllerCode);
    const controllerAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: controllerParse.classes,
      reExports: controllerParse.reExports,
      exports: controllerParse.exports,
      importEntries: [
        { source: '@test/a', resolvedSource: entryA, isRelative: false },
        { source: '@test/b', resolvedSource: entryB, isRelative: false },
      ],
    };

    applyParseToAnalysis(controllerAnalysis, controllerParse);
    fileMap.set(controllerFile, controllerAnalysis);

    // Same name 'test' for both
    const adapterA = createAdapterValue();
    const adapterB = createAdapterValue({
      pipeline: ['After', 'Guards', 'Pipes', 'Handler'],
    });

    for (const [ep, val] of [
      [entryA, adapterA],
      [entryB, adapterB],
    ] as const) {
      const parse = parser.parse(ep as string, 'export const adapterSpec = defineAdapter({});');
      const analysis: FileAnalysis = {
        filePath: ep as string,
        classes: parse.classes,
        reExports: parse.reExports,
        exports: parse.exports,
        exportedValues: { adapterSpec: wrapDefineAdapter(val) },
      };

      applyParseToAnalysis(analysis, parse);
      fileMap.set(ep as string, analysis);
    }

    const resolver = new AdapterSpecResolver();

    // Act & Assert — duplicate before middleware/controller validation
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/Duplicate adapterId/);
    }
  });

  // =======================================================================
  // Ordering (OR)
  // =======================================================================

  it('should sort adapterStaticSpecs alphabetically', async () => {
    // Arrange
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();
    const entryA = join(projectRoot, 'adapters', 'a', 'index.ts');
    const entryB = join(projectRoot, 'adapters', 'b', 'index.ts');

    // Controller for alpha
    const controllerParse = parser.parse(controllerFile, controllerCode);
    const controllerAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: controllerParse.classes,
      reExports: controllerParse.reExports,
      exports: controllerParse.exports,
      importEntries: [{ source: '@test/a', resolvedSource: entryA, isRelative: false }],
    };

    applyParseToAnalysis(controllerAnalysis, controllerParse);
    fileMap.set(controllerFile, controllerAnalysis);

    // Controller for bravo
    const controllerFileB = join(srcDir, 'ws.ts');
    const controllerCodeB = [
      'function WsGateway() { return () => {}; }',
      'function OnMessage() { return () => {}; }',
      '',
      '@WsGateway()',
      'class WsHandler {',
      '  @OnMessage()',
      '  onMsg() {}',
      '}',
    ].join('\n');
    const controllerParseB = parser.parse(controllerFileB, controllerCodeB);
    const controllerAnalysisB: FileAnalysis = {
      filePath: controllerFileB,
      classes: controllerParseB.classes,
      reExports: controllerParseB.reExports,
      exports: controllerParseB.exports,
      importEntries: [{ source: '@test/b', resolvedSource: entryB, isRelative: false }],
    };

    applyParseToAnalysis(controllerAnalysisB, controllerParseB);
    fileMap.set(controllerFileB, controllerAnalysisB);

    // Adapter 'bravo' registered first alphabetically in entry paths, but name starts with 'b'
    const adapterBravo = createAdapterValue({
      name: 'bravo',
      decorators: {
        controller: { __zipbul_ref: 'WsGateway' },
        handler: [{ __zipbul_ref: 'OnMessage' }],
      },
    });
    const adapterAlpha = createAdapterValue({ name: 'alpha' });

    // entryA → alpha, entryB → bravo
    for (const [ep, val] of [
      [entryA, adapterAlpha],
      [entryB, adapterBravo],
    ] as const) {
      const parse = parser.parse(ep as string, 'export const adapterSpec = defineAdapter({});');
      const analysis: FileAnalysis = {
        filePath: ep as string,
        classes: parse.classes,
        reExports: parse.reExports,
        exports: parse.exports,
        exportedValues: { adapterSpec: wrapDefineAdapter(val) },
      };

      applyParseToAnalysis(analysis, parse);
      fileMap.set(ep as string, analysis);
    }

    const resolver = new AdapterSpecResolver();

    // Act
    const result = await resolver.resolve({ fileMap, projectRoot });

    // Assert — alphabetical order
    expect(Object.keys(result.adapterStaticSpecs)).toEqual(['alpha', 'bravo']);
  });

  it('should sort handler index alphabetically', async () => {
    // Arrange — two controllers for the same adapter, different file paths
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();

    const controllerFileZ = join(srcDir, 'z-controller.ts');
    const controllerFileA = join(srcDir, 'a-controller.ts');

    for (const file of [controllerFileZ, controllerFileA]) {
      const controllerParse = parser.parse(file, controllerCode);
      const controllerAnalysis: FileAnalysis = {
        filePath: file,
        classes: controllerParse.classes,
        reExports: controllerParse.reExports,
        exports: controllerParse.exports,
        importEntries: [{ source: '@test/adapter', resolvedSource: entryFile, isRelative: false }],
      };

      applyParseToAnalysis(controllerAnalysis, controllerParse);
      fileMap.set(file, controllerAnalysis);
    }

    const entryParse = parser.parse(entryFile, 'export const adapterSpec = defineAdapter({});');
    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: entryParse.classes,
      reExports: entryParse.reExports,
      exports: entryParse.exports,
      exportedValues: { adapterSpec: wrapDefineAdapter(createAdapterValue()) },
    };

    applyParseToAnalysis(entryAnalysis, entryParse);
    fileMap.set(entryFile, entryAnalysis);

    const resolver = new AdapterSpecResolver();

    // Act
    const result = await resolver.resolve({ fileMap, projectRoot });

    // Assert — a-controller should come before z-controller
    const ids = result.handlerIndex.map(e => e.id);

    expect(ids.length).toBe(2);
    expect(ids[0]!.includes('a-controller')).toBe(true);
    expect(ids[1]!.includes('z-controller')).toBe(true);
  });

  // =======================================================================
  // P3 — Entry Decorator AOT Validation (ADAPTER-R-010)
  // =======================================================================

  // --- P3 helper ---

  const buildFileMapWithCode = (
    controllerSource: string,
    adapterValue: AnalyzerValueRecord = createAdapterValue(),
  ): Map<string, FileAnalysis> => {
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();

    const controllerParse = parser.parse(controllerFile, controllerSource);
    const controllerAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: controllerParse.classes,
      reExports: controllerParse.reExports,
      exports: controllerParse.exports,
      importEntries: [{ source: '@test/adapter', resolvedSource: entryFile, isRelative: false }],
    };

    applyParseToAnalysis(controllerAnalysis, controllerParse);
    fileMap.set(controllerFile, controllerAnalysis);

    const entryParse = parser.parse(entryFile, 'export const adapterSpec = defineAdapter({});');
    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: entryParse.classes,
      reExports: entryParse.reExports,
      exports: entryParse.exports,
      exportedValues: { adapterSpec: wrapDefineAdapter(adapterValue) },
    };

    applyParseToAnalysis(entryAnalysis, entryParse);
    fileMap.set(entryFile, entryAnalysis);

    return fileMap;
  };

  it('should resolve controller with adapterIds filtering when multiple adapters share decorator name', async () => {
    // Arrange — two adapters both use 'Controller', adapterIds=['test'] filters to one
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();
    const otherEntryFile = join(projectRoot, 'adapters', 'other-adapter', 'index.ts');

    const code = [
      'function Controller() { return () => {}; }',
      'function Get() { return () => {}; }',
      '',
      '@Controller({ adapterIds: ["test"] })',
      'class FilteredController {',
      '  @Get()',
      '  handle() {}',
      '}',
    ].join('\n');

    const ctrlParse = parser.parse(controllerFile, code);
    const ctrlAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: ctrlParse.classes,
      reExports: ctrlParse.reExports,
      exports: ctrlParse.exports,
      importEntries: [
        { source: '@test/adapter', resolvedSource: entryFile, isRelative: false },
        { source: '@other/adapter', resolvedSource: otherEntryFile, isRelative: false },
      ],
    };

    applyParseToAnalysis(ctrlAnalysis, ctrlParse);
    fileMap.set(controllerFile, ctrlAnalysis);

    // Adapter 'test'
    const testValue = createAdapterValue();
    const testParse = parser.parse(entryFile, 'export const adapterSpec = defineAdapter({});');
    const testEntry: FileAnalysis = {
      filePath: entryFile,
      classes: testParse.classes,
      reExports: testParse.reExports,
      exports: testParse.exports,
      exportedValues: { adapterSpec: wrapDefineAdapter(testValue) },
    };

    applyParseToAnalysis(testEntry, testParse);
    fileMap.set(entryFile, testEntry);

    // Adapter 'other' (same controller decorator name 'Controller')
    const otherValue = createAdapterValue({ name: 'other' });
    const otherParse = parser.parse(otherEntryFile, 'export const adapterSpec = defineAdapter({});');
    const otherEntry: FileAnalysis = {
      filePath: otherEntryFile,
      classes: otherParse.classes,
      reExports: otherParse.reExports,
      exports: otherParse.exports,
      exportedValues: { adapterSpec: wrapDefineAdapter(otherValue) },
    };

    applyParseToAnalysis(otherEntry, otherParse);
    fileMap.set(otherEntryFile, otherEntry);

    const resolver = new AdapterSpecResolver();

    // Act
    const result = await resolver.resolve({ fileMap, projectRoot });

    // Assert — only 'test' adapter handler should appear
    expect(result.handlerIndex.length).toBe(1);
    expect(result.handlerIndex[0]!.id).toContain('test:');
  });

  it('should throw when handler method is static', async () => {
    const code = [
      'function Controller() { return () => {}; }',
      'function Get() { return () => {}; }',
      '',
      '@Controller()',
      'class StaticController {',
      '  @Get()',
      '  static handle() {}',
      '}',
    ].join('\n');

    const fileMap = buildFileMapWithCode(code);
    const resolver = new AdapterSpecResolver();

    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/static/i);
    }
  });

  it('should throw when handler method uses computed property name', async () => {
    const code = [
      'function Controller() { return () => {}; }',
      'function Get() { return () => {}; }',
      '',
      '@Controller()',
      'class ComputedController {',
      '  @Get()',
      '  [Symbol.iterator]() {}',
      '}',
    ].join('\n');

    const fileMap = buildFileMapWithCode(code);
    const resolver = new AdapterSpecResolver();

    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/computed/i);
    }
  });

  it('should throw when handler method is private (#name)', async () => {
    const code = [
      'function Controller() { return () => {}; }',
      'function Get() { return () => {}; }',
      '',
      '@Controller()',
      'class PrivateController {',
      '  @Get()',
      '  #handle() {}',
      '}',
    ].join('\n');

    const fileMap = buildFileMapWithCode(code);
    const resolver = new AdapterSpecResolver();

    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/private/i);
    }
  });

  it('should throw when adapterIds is not an array', async () => {
    const code = [
      'function Controller() { return () => {}; }',
      'function Get() { return () => {}; }',
      '',
      '@Controller({ adapterIds: "test" })',
      'class BadAdapterIds {',
      '  @Get()',
      '  handle() {}',
      '}',
    ].join('\n');

    const fileMap = buildFileMapWithCode(code);
    const resolver = new AdapterSpecResolver();

    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/adapterIds/);
    }
  });

  it('should throw when adapterIds is empty array', async () => {
    const code = [
      'function Controller() { return () => {}; }',
      'function Get() { return () => {}; }',
      '',
      '@Controller({ adapterIds: [] })',
      'class EmptyAdapterIds {',
      '  @Get()',
      '  handle() {}',
      '}',
    ].join('\n');

    const fileMap = buildFileMapWithCode(code);
    const resolver = new AdapterSpecResolver();

    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/adapterIds/);
    }
  });

  it('should throw when adapterIds element is not a string', async () => {
    const code = [
      'function Controller() { return () => {}; }',
      'function Get() { return () => {}; }',
      '',
      '@Controller({ adapterIds: [42] })',
      'class NumericAdapterId {',
      '  @Get()',
      '  handle() {}',
      '}',
    ].join('\n');

    const fileMap = buildFileMapWithCode(code);
    const resolver = new AdapterSpecResolver();

    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/adapterIds/);
    }
  });

  it('should throw when adapterIds contains unknown adapterId', async () => {
    const code = [
      'function Controller() { return () => {}; }',
      'function Get() { return () => {}; }',
      '',
      '@Controller({ adapterIds: ["nonexistent"] })',
      'class UnknownAdapterId {',
      '  @Get()',
      '  handle() {}',
      '}',
    ].join('\n');

    const fileMap = buildFileMapWithCode(code);
    const resolver = new AdapterSpecResolver();

    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/nonexistent/);
    }
  });

  it('should throw for isStatic before isPrivateName when both are true', async () => {
    const code = [
      'function Controller() { return () => {}; }',
      'function Get() { return () => {}; }',
      '',
      '@Controller()',
      'class DualViolation {',
      '  @Get()',
      '  static #handle() {}',
      '}',
    ].join('\n');

    const fileMap = buildFileMapWithCode(code);
    const resolver = new AdapterSpecResolver();

    // isStatic check should fire first, not isPrivateName
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/static/i);
    }
  });
});
