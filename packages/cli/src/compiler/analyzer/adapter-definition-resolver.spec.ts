import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { join } from 'path';

import { isErr } from '@zipbul/result';
import { ZIPBUL_UNRESOLVABLE } from '@zipbul/common';
import type { FileAnalysis } from './graph/interfaces';

import type { FileSetup } from '../../../test/shared/interfaces';
import type { AstParseResult } from './test/types';
import type { AnalyzerValue, AnalyzerValueRecord } from './types';
import type { ClassMetadata, PropertyMetadata } from './interfaces';

import { createBunFileStub } from '../../../test/shared/stubs';
import { PathResolver } from '../../common';
import { AstParser } from './parser';

import { AdapterDefinitionResolver } from './adapter';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function parseOrFail(parser: AstParser, filename: string, code: string): Promise<AstParseResult> {
  const result = await parser.parse(filename, code);

  if (isErr(result)) {
    throw new Error(`Unexpected parse failure: ${result.data.why}`);
  }

  return result;
}

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
 * Build PropertyMetadata entries for an adapter class.
 * Each field mirrors how AstParser extracts property initializers.
 */
const createAdapterProperties = (overrides?: Partial<Record<string, AnalyzerValue>>): PropertyMetadata[] => {
  const values: Record<string, AnalyzerValue> = {
    decorators: {
      controller: { __zipbul_ref: 'Controller' },
      handlers: [{ __zipbul_ref: 'Get' }],
    },
    validPhases: {
      __zipbul_new: 'Set',
      args: [{
        __zipbul_call: 'Object.values',
        args: [{ __zipbul_ref: 'TestPhase', __zipbul_import_source: '/project/adapters/test-adapter/enums.ts' }],
      }],
    },
    ...overrides,
  };

  return Object.entries(values)
    .filter(([_, value]) => value !== undefined)
    .map(([propName, value]) => ({
      name: propName,
      type: 'any',
      decorators: [],
      initializer: value,
    }));
};

/**
 * Build a ClassMetadata for the test adapter class.
 */
const createTestAdapterClass = (
  className: string = 'TestAdapter',
  propertyOverrides?: Partial<Record<string, AnalyzerValue>>,
): ClassMetadata => ({
  className,
  decorators: [],
  constructorParams: [],
  methods: [],
  properties: createAdapterProperties(propertyOverrides),
  imports: {},
});

const wrapDefineAdapter = (...args: AnalyzerValue[]): AnalyzerValueRecord => ({
  __zipbul_call: 'defineAdapter',
  args,
});

/**
 * Build a config object for `defineAdapter({ adapter, context, step, phase, ... })`.
 * The `phase` field references the TestPhase enum from the standard enum file.
 */
const buildAdapterConfig = (
  adapterRef: AnalyzerValue,
  overrides?: Record<string, AnalyzerValue>,
): AnalyzerValueRecord => ({
  adapter: adapterRef,
  context: { __zipbul_ref: 'TestContext' },
  step: { __zipbul_ref: 'TestStep' },
  phase: { __zipbul_ref: 'TestPhase', __zipbul_import_source: '/project/adapters/test-adapter/enums.ts' },
  ...overrides,
});

/** Adds the TestPhase enum file to a fileMap so validPhases can be resolved. */
const addTestPhaseEnum = (fileMap: Map<string, FileAnalysis>, enumDir: string = '/project/adapters/test-adapter'): void => {
  const enumFile = join(enumDir, 'enums.ts');

  if (fileMap.has(enumFile)) {
    return;
  }

  fileMap.set(enumFile, {
    filePath: enumFile,
    classes: [],
    reExports: [],
    exports: ['TestPhase'],
    enums: new Map([['TestPhase', new Map([
      ['OnReceive', 'OnReceive'],
      ['PostParse', 'PostParse'],
      ['PreHandle', 'PreHandle'],
      ['OnComplete', 'OnComplete'],
    ])]]),
  });
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('AdapterDefinitionResolver', () => {
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

  const buildStandardFileMap = async (
    adapterClass: ClassMetadata = createTestAdapterClass(),
  ): Promise<Map<string, FileAnalysis>> => {
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();

    // Controller file
    const controllerParse = await parseOrFail(parser, controllerFile, controllerCode);
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
    const entryParse = await parseOrFail(parser, entryFile, 'export const adapterDefinition = defineAdapter({ adapter: TestAdapter });');
    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: [adapterClass],
      reExports: entryParse.reExports,
      exports: entryParse.exports,
      exportedValues: { adapterDefinition: wrapDefineAdapter(buildAdapterConfig({ __zipbul_ref: adapterClass.className })) },
    };

    applyParseToAnalysis(entryAnalysis, entryParse);
    fileMap.set(entryFile, entryAnalysis);

    // Enum file for validPhases resolution
    addTestPhaseEnum(fileMap);

    return fileMap;
  };

  // =======================================================================
  // Happy Path (HP)
  // =======================================================================

  it('should resolve adapter with class reference containing all required property initializers', async () => {
    // Arrange
    const fileMap = await buildStandardFileMap();
    const resolver = new AdapterDefinitionResolver();

    // Act
    const result = await resolver.resolve({ fileMap, projectRoot });

    // Assert
    expect(Object.keys(result.adapterStaticSchemas)).toEqual(['TestAdapter']);

    const spec = result.adapterStaticSchemas.TestAdapter;

    expect(spec?.entryDecorators).toEqual({ controller: 'Controller', handlers: ['Get'] });
  });

  it('should resolve multiple adapters from different entry files', async () => {
    // Arrange
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();
    const entryA = join(projectRoot, 'adapters', 'a', 'index.ts');
    const entryB = join(projectRoot, 'adapters', 'b', 'index.ts');

    // Controller that imports both
    const controllerParse = await parseOrFail(parser, controllerFile, controllerCode);
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
    const controllerParseB = await parseOrFail(parser, controllerFileB, controllerCodeB);
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
    const adapterAClass = createTestAdapterClass('AdapterA');
    const entryParseA = await parseOrFail(parser, entryA, 'export const adapterDefinition = defineAdapter({ adapter: AdapterA });');
    const entryAnalysisA: FileAnalysis = {
      filePath: entryA,
      classes: [adapterAClass],
      reExports: entryParseA.reExports,
      exports: entryParseA.exports,
      exportedValues: { adapterDefinition: wrapDefineAdapter(buildAdapterConfig({ __zipbul_ref: 'AdapterA' })) },
    };

    applyParseToAnalysis(entryAnalysisA, entryParseA);
    fileMap.set(entryA, entryAnalysisA);

    // Adapter B entry
    const adapterBClass = createTestAdapterClass('AdapterB', {
      decorators: {
        controller: { __zipbul_ref: 'WsGateway' },
        handlers: [{ __zipbul_ref: 'OnMessage' }],
      },
    });
    const entryParseB = await parseOrFail(parser, entryB, 'export const adapterDefinition = defineAdapter({ adapter: AdapterB });');
    const entryAnalysisB: FileAnalysis = {
      filePath: entryB,
      classes: [adapterBClass],
      reExports: entryParseB.reExports,
      exports: entryParseB.exports,
      exportedValues: { adapterDefinition: wrapDefineAdapter(buildAdapterConfig({ __zipbul_ref: 'AdapterB' })) },
    };

    applyParseToAnalysis(entryAnalysisB, entryParseB);
    fileMap.set(entryB, entryAnalysisB);

    addTestPhaseEnum(fileMap);

    const resolver = new AdapterDefinitionResolver();

    // Act
    const result = await resolver.resolve({ fileMap, projectRoot });

    // Assert
    expect(Object.keys(result.adapterStaticSchemas)).toEqual(['AdapterA', 'AdapterB']);
  });

  it('should resolve adapterDefinition via re-export barrel (export all)', async () => {
    // Arrange
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();
    const barrelFile = join(adapterDir, 'index.ts');
    const specFile = join(adapterDir, 'spec.ts');

    // Controller imports barrel
    const controllerParse = await parseOrFail(parser, controllerFile, controllerCode);
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

    // Spec file has actual adapterDefinition + class
    const adapterClass = createTestAdapterClass();
    const specAnalysis: FileAnalysis = {
      filePath: specFile,
      classes: [adapterClass],
      reExports: [],
      exports: ['adapterDefinition'],
      exportedValues: { adapterDefinition: wrapDefineAdapter(buildAdapterConfig({ __zipbul_ref: 'TestAdapter' })) },
    };

    fileMap.set(specFile, specAnalysis);

    addTestPhaseEnum(fileMap);

    const resolver = new AdapterDefinitionResolver();

    // Act
    const result = await resolver.resolve({ fileMap, projectRoot });

    // Assert
    expect(Object.keys(result.adapterStaticSchemas)).toEqual(['TestAdapter']);
  });

  it('should resolve adapterDefinition via named re-export', async () => {
    // Arrange
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();
    const barrelFile = join(adapterDir, 'index.ts');
    const specFile = join(adapterDir, 'spec.ts');

    const controllerParse = await parseOrFail(parser, controllerFile, controllerCode);
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
      reExports: [{ module: specFile, names: [{ local: 'adapterDefinition', exported: 'adapterDefinition' }] }],
      exports: [],
    };

    fileMap.set(barrelFile, barrelAnalysis);

    const adapterClass = createTestAdapterClass();
    const specAnalysis: FileAnalysis = {
      filePath: specFile,
      classes: [adapterClass],
      reExports: [],
      exports: ['adapterDefinition'],
      exportedValues: { adapterDefinition: wrapDefineAdapter(buildAdapterConfig({ __zipbul_ref: 'TestAdapter' })) },
    };

    fileMap.set(specFile, specAnalysis);

    addTestPhaseEnum(fileMap);

    const resolver = new AdapterDefinitionResolver();

    // Act
    const result = await resolver.resolve({ fileMap, projectRoot });

    // Assert
    expect(Object.keys(result.adapterStaticSchemas)).toEqual(['TestAdapter']);
  });

  it('should build handlerIndex with correct id format', async () => {
    // Arrange
    const fileMap = await buildStandardFileMap();
    const resolver = new AdapterDefinitionResolver();

    // Act
    const result = await resolver.resolve({ fileMap, projectRoot });

    // Assert
    const expectedFile = PathResolver.normalize('src/controllers.ts');
    const expectedId = `TestAdapter:${expectedFile}#SampleController.handle`;

    expect(result.handlerIndex.map(e => e.id)).toEqual([expectedId]);
  });

  it('should collect middleware phase ids from module config', async () => {
    // Arrange
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();

    const moduleFile = join(srcDir, 'app.module.ts');
    const moduleCode = [
      "import { defineModule } from '@zipbul/common';",
      "import { TestAdapter } from '@test/adapter';",
      '',
      'export default defineModule({',
      "  name: 'app',",
      '  adapters: [',
      '    {',
      '      adapter: TestAdapter,',
      '      middlewares: {',
      '        OnReceive: [],',
      '      },',
      '    },',
      '  ],',
      '});',
    ].join('\n');

    const moduleParse = await parseOrFail(parser, moduleFile, moduleCode);
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
    const controllerParse = await parseOrFail(parser, controllerFile, controllerCode);
    const controllerAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: controllerParse.classes,
      reExports: controllerParse.reExports,
      exports: controllerParse.exports,
    };

    applyParseToAnalysis(controllerAnalysis, controllerParse);
    fileMap.set(controllerFile, controllerAnalysis);

    // Entry file
    const adapterClass = createTestAdapterClass();
    const entryParse = await parseOrFail(parser, entryFile, 'export const adapterDefinition = defineAdapter({ adapter: TestAdapter });');
    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: [adapterClass],
      reExports: entryParse.reExports,
      exports: entryParse.exports,
      exportedValues: { adapterDefinition: wrapDefineAdapter(buildAdapterConfig({ __zipbul_ref: 'TestAdapter' })) },
    };

    applyParseToAnalysis(entryAnalysis, entryParse);
    fileMap.set(entryFile, entryAnalysis);

    addTestPhaseEnum(fileMap);

    const resolver = new AdapterDefinitionResolver();

    // Act & Assert — should not throw (module middleware hook 'OnReceive' is valid)
    const result = await resolver.resolve({ fileMap, projectRoot });

    expect(Object.keys(result.adapterStaticSchemas)).toEqual(['TestAdapter']);
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
      "  @Middlewares('PreHandle', [mwOne])",
      '  handle() {}',
      '}',
    ].join('\n');

    const controllerParse = await parseOrFail(parser, controllerFile, code);
    const controllerAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: controllerParse.classes,
      reExports: controllerParse.reExports,
      exports: controllerParse.exports,
      importEntries: [{ source: '@test/adapter', resolvedSource: entryFile, isRelative: false }],
    };

    applyParseToAnalysis(controllerAnalysis, controllerParse);
    fileMap.set(controllerFile, controllerAnalysis);

    const adapterClass = createTestAdapterClass();
    const entryParse = await parseOrFail(parser, entryFile, 'export const adapterDefinition = defineAdapter({ adapter: TestAdapter });');
    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: [adapterClass],
      reExports: entryParse.reExports,
      exports: entryParse.exports,
      exportedValues: { adapterDefinition: wrapDefineAdapter(buildAdapterConfig({ __zipbul_ref: 'TestAdapter' })) },
    };

    applyParseToAnalysis(entryAnalysis, entryParse);
    fileMap.set(entryFile, entryAnalysis);

    addTestPhaseEnum(fileMap);

    const resolver = new AdapterDefinitionResolver();

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
      '  @Middlewares({ PreHandle: [mwOne] })',
      '  handle() {}',
      '}',
    ].join('\n');

    const controllerParse = await parseOrFail(parser, controllerFile, code);
    const controllerAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: controllerParse.classes,
      reExports: controllerParse.reExports,
      exports: controllerParse.exports,
      importEntries: [{ source: '@test/adapter', resolvedSource: entryFile, isRelative: false }],
    };

    applyParseToAnalysis(controllerAnalysis, controllerParse);
    fileMap.set(controllerFile, controllerAnalysis);

    const adapterClass = createTestAdapterClass();
    const entryParse = await parseOrFail(parser, entryFile, 'export const adapterDefinition = defineAdapter({ adapter: TestAdapter });');
    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: [adapterClass],
      reExports: entryParse.reExports,
      exports: entryParse.exports,
      exportedValues: { adapterDefinition: wrapDefineAdapter(buildAdapterConfig({ __zipbul_ref: 'TestAdapter' })) },
    };

    applyParseToAnalysis(entryAnalysis, entryParse);
    fileMap.set(entryFile, entryAnalysis);

    addTestPhaseEnum(fileMap);

    const resolver = new AdapterDefinitionResolver();

    // Act & Assert
    const result = await resolver.resolve({ fileMap, projectRoot });

    expect(result.handlerIndex.length).toBe(1);
  });

  // =======================================================================
  // Negative / Error (NE)
  // =======================================================================

  it('should throw when adapterDefinition is not defineAdapter call', async () => {
    // Arrange
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();

    const controllerParse = await parseOrFail(parser, controllerFile, controllerCode);
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
      exports: ['adapterDefinition'],
      exportedValues: { adapterDefinition: { __zipbul_call: 'someOtherFn', args: [] } },
    };

    fileMap.set(entryFile, entryAnalysis);

    const resolver = new AdapterDefinitionResolver();

    // Act & Assert
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/Adapter definition must use defineAdapter/);
    }
  });

  it('should throw when defineAdapter has wrong argument count', async () => {
    // Arrange
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();

    const controllerParse = await parseOrFail(parser, controllerFile, controllerCode);
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
      exports: ['adapterDefinition'],
      exportedValues: { adapterDefinition: wrapDefineAdapter('a', 'b') },
    };

    fileMap.set(entryFile, entryAnalysis);

    const resolver = new AdapterDefinitionResolver();

    // Act & Assert
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/exactly one argument/);
    }
  });

  it('should throw when defineAdapter argument is not a config object', async () => {
    // Arrange
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();

    const controllerParse = await parseOrFail(parser, controllerFile, controllerCode);
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
      exports: ['adapterDefinition'],
      exportedValues: { adapterDefinition: wrapDefineAdapter('not-a-config-object') },
    };

    fileMap.set(entryFile, entryAnalysis);

    const resolver = new AdapterDefinitionResolver();

    // Act & Assert
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/config object/);
    }
  });

  it('should throw when referenced class cannot be found', async () => {
    // Arrange
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();

    const controllerParse = await parseOrFail(parser, controllerFile, controllerCode);
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
      exports: ['adapterDefinition'],
      exportedValues: { adapterDefinition: wrapDefineAdapter(buildAdapterConfig({ __zipbul_ref: 'NonExistentClass' })) },
    };

    fileMap.set(entryFile, entryAnalysis);

    const resolver = new AdapterDefinitionResolver();

    // Act & Assert
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/Could not find class/);
    }
  });

  it('should use class name as adapterId (name property not required)', async () => {
    // Arrange — no name property, adapterId derives from className
    const fileMap = await buildStandardFileMap(createTestAdapterClass('MyCustomAdapter'));
    const resolver = new AdapterDefinitionResolver();

    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(Object.keys(result.adapterStaticSchemas)).toEqual(['MyCustomAdapter']);
  });

  it('should throw when decorators.controller is not an identifier', async () => {
    // Arrange
    const fileMap = await buildStandardFileMap(
      createTestAdapterClass('TestAdapter', {
        decorators: {
          controller: 'plain-string',
          handlers: [{ __zipbul_ref: 'Get' }],
        },
      }),
    );
    const resolver = new AdapterDefinitionResolver();

    // Act & Assert
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/controller/);
    }
  });

  it('should throw when decorators.handlers is empty or invalid', async () => {
    // Arrange — empty handler array
    const fileMap1 = await buildStandardFileMap(
      createTestAdapterClass('TestAdapter', {
        decorators: {
          controller: { __zipbul_ref: 'Controller' },
          handlers: [],
        },
      }),
    );
    const resolver = new AdapterDefinitionResolver();

    const result1 = await resolver.resolve({ fileMap: fileMap1, projectRoot });
    expect(isErr(result1)).toBe(true);
    if (isErr(result1)) {
      expect(result1.data.why).toMatch(/handler/);
    }

    // Arrange — handler element not identifier
    const fileMap2 = await buildStandardFileMap(
      createTestAdapterClass('TestAdapter', {
        decorators: {
          controller: { __zipbul_ref: 'Controller' },
          handlers: ['plain-string'],
        },
      }),
    );

    const result2 = await resolver.resolve({ fileMap: fileMap2, projectRoot });
    expect(isErr(result2)).toBe(true);
    if (isErr(result2)) {
      expect(result2.data.why).toMatch(/handler/);
    }
  });

  it('should throw when no adapter definition found', async () => {
    // Arrange
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();
    const controllerParse = await parseOrFail(parser, controllerFile, 'class Empty {}');
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

    const resolver = new AdapterDefinitionResolver();

    // Act & Assert
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/No adapter definition found/);
    }
  });

  it('should throw on duplicate adapterId', async () => {
    // Arrange
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();
    const entryA = join(projectRoot, 'adapters', 'a', 'index.ts');
    const entryB = join(projectRoot, 'adapters', 'b', 'index.ts');

    const controllerParse = await parseOrFail(parser, controllerFile, controllerCode);
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

    // Both adapters use same className → same adapterId
    for (const ep of [entryA, entryB]) {
      const adapterClass = createTestAdapterClass(`Adapter_${ep.split('/').pop()}`);
      const parse = await parseOrFail(parser, ep, 'export const adapterDefinition = defineAdapter({ adapter: TestAdapter });');
      const analysis: FileAnalysis = {
        filePath: ep,
        classes: [adapterClass],
        reExports: parse.reExports,
        exports: parse.exports,
        exportedValues: { adapterDefinition: wrapDefineAdapter(buildAdapterConfig({ __zipbul_ref: adapterClass.className })) },
      };

      applyParseToAnalysis(analysis, parse);
      fileMap.set(ep, analysis);
    }

    const resolver = new AdapterDefinitionResolver();

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

    const controllerParse = await parseOrFail(parser, controllerFile, code);
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

    const adapterAClass = createTestAdapterClass('AdapterA');
    const adapterBClass = createTestAdapterClass('AdapterB', {
      decorators: {
        controller: { __zipbul_ref: 'WsGateway' },
        handlers: [{ __zipbul_ref: 'OnMessage' }],
      },
    });

    for (const [ep, cls] of [
      [entryA, adapterAClass],
      [entryB, adapterBClass],
    ] as const) {
      const parse = await parseOrFail(parser, ep as string, 'export const adapterDefinition = defineAdapter({ adapter: Adapter });');
      const analysis: FileAnalysis = {
        filePath: ep as string,
        classes: [cls],
        reExports: parse.reExports,
        exports: parse.exports,
        exportedValues: { adapterDefinition: wrapDefineAdapter(buildAdapterConfig({ __zipbul_ref: cls.className })) },
      };

      applyParseToAnalysis(analysis, parse);
      fileMap.set(ep as string, analysis);
    }

    const resolver = new AdapterDefinitionResolver();

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

    const controllerParse = await parseOrFail(parser, controllerFile, code);
    const controllerAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: controllerParse.classes,
      reExports: controllerParse.reExports,
      exports: controllerParse.exports,
      importEntries: [{ source: '@test/adapter', resolvedSource: entryFile, isRelative: false }],
    };

    applyParseToAnalysis(controllerAnalysis, controllerParse);
    fileMap.set(controllerFile, controllerAnalysis);

    const adapterClass = createTestAdapterClass();
    const entryParse = await parseOrFail(parser, entryFile, 'export const adapterDefinition = defineAdapter({ adapter: TestAdapter });');
    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: [adapterClass],
      reExports: entryParse.reExports,
      exports: entryParse.exports,
      exportedValues: { adapterDefinition: wrapDefineAdapter(buildAdapterConfig({ __zipbul_ref: 'TestAdapter' })) },
    };

    applyParseToAnalysis(entryAnalysis, entryParse);
    fileMap.set(entryFile, entryAnalysis);

    addTestPhaseEnum(fileMap);

    const resolver = new AdapterDefinitionResolver();

    // Act & Assert
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

    const adapterClass = createTestAdapterClass();
    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: [adapterClass],
      reExports: [],
      exports: ['adapterDefinition'],
      exportedValues: { adapterDefinition: wrapDefineAdapter(buildAdapterConfig({ __zipbul_ref: 'TestAdapter' })) },
    };

    fileMap.set(entryFile, entryAnalysis);

    addTestPhaseEnum(fileMap);

    const resolver = new AdapterDefinitionResolver();

    // Act & Assert
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/Duplicate handler id/);
    }
  });

  it('should throw when middleware phase is unsupported', async () => {
    // Arrange — @UseMiddlewares uses phase 'Unknown' which is not supported
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();

    const code = [
      'function Controller() { return () => {}; }',
      'function Get() { return () => {}; }',
      'function UseMiddlewares() { return () => {}; }',
      'function mwOne() {}',
      '',
      '@Controller()',
      'class SampleController {',
      '  @Get()',
      "  @UseMiddlewares('Unknown', [mwOne])",
      '  handle() {}',
      '}',
    ].join('\n');

    const controllerParse = await parseOrFail(parser, controllerFile, code);
    const controllerAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: controllerParse.classes,
      reExports: controllerParse.reExports,
      exports: controllerParse.exports,
      importEntries: [{ source: '@test/adapter', resolvedSource: entryFile, isRelative: false }],
    };

    applyParseToAnalysis(controllerAnalysis, controllerParse);
    fileMap.set(controllerFile, controllerAnalysis);

    const adapterClass = createTestAdapterClass();
    const entryParse = await parseOrFail(parser, entryFile, 'export const adapterDefinition = defineAdapter({ adapter: TestAdapter });');
    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: [adapterClass],
      reExports: entryParse.reExports,
      exports: entryParse.exports,
      exportedValues: { adapterDefinition: wrapDefineAdapter(buildAdapterConfig({ __zipbul_ref: 'TestAdapter' })) },
    };

    applyParseToAnalysis(entryAnalysis, entryParse);
    fileMap.set(entryFile, entryAnalysis);

    addTestPhaseEnum(fileMap);

    const resolver = new AdapterDefinitionResolver();

    // Act & Assert
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/Unsupported middleware phase/);
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
    const noClassParse = await parseOrFail(parser, controllerFile, noClassCode);
    const noClassAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: noClassParse.classes,
      reExports: noClassParse.reExports,
      exports: noClassParse.exports,
      importEntries: [{ source: '@test/adapter', resolvedSource: entryFile, isRelative: false }],
    };

    applyParseToAnalysis(noClassAnalysis, noClassParse);
    fileMap.set(controllerFile, noClassAnalysis);

    const adapterClass = createTestAdapterClass();
    const entryParse = await parseOrFail(parser, entryFile, 'export const adapterDefinition = defineAdapter({ adapter: TestAdapter });');
    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: [adapterClass],
      reExports: entryParse.reExports,
      exports: entryParse.exports,
      exportedValues: { adapterDefinition: wrapDefineAdapter(buildAdapterConfig({ __zipbul_ref: 'TestAdapter' })) },
    };

    applyParseToAnalysis(entryAnalysis, entryParse);
    fileMap.set(entryFile, entryAnalysis);

    addTestPhaseEnum(fileMap);

    const resolver = new AdapterDefinitionResolver();

    // Act
    const result = await resolver.resolve({ fileMap, projectRoot });

    // Assert
    expect(result.handlerIndex).toEqual([]);
    expect(Object.keys(result.adapterStaticSchemas)).toEqual(['TestAdapter']);
  });

  it('should handle file not found on disk when resolving entry', async () => {
    // Arrange — entry file not in fileMap AND not on disk
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();

    const nonExistentEntry = join(projectRoot, 'nonexistent', 'index.ts');

    const controllerParse = await parseOrFail(parser, controllerFile, controllerCode);
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

    const resolver = new AdapterDefinitionResolver();

    // Act & Assert — no adapterDefinition found since file doesn't exist
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/No adapter definition found/);
    }
  });

  it('should handle entry file path normalization (non-.ts ignored)', async () => {
    // Arrange — import resolves to non-.ts path → ignored by collectPackageEntryFiles
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();

    const controllerParse = await parseOrFail(parser, controllerFile, controllerCode);
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

    const resolver = new AdapterDefinitionResolver();

    // Act & Assert — no .ts entry → no adapterDefinition found
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/No adapter definition found/);
    }
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

    const controllerParse = await parseOrFail(parser, controllerFile, controllerCode);
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

    const resolver = new AdapterDefinitionResolver();

    // Act & Assert — should not stack overflow, instead throws "No adapterDefinition"
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/No adapter definition found/);
    }
  });

  it('should throw duplicate adapterId before reaching validation', async () => {
    // Arrange — two adapters with same id but different phase configs
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();
    const entryA = join(projectRoot, 'adapters', 'a', 'index.ts');
    const entryB = join(projectRoot, 'adapters', 'b', 'index.ts');

    const controllerParse = await parseOrFail(parser, controllerFile, controllerCode);
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

    // Same className → same adapterId → duplicate
    const adapterA = createTestAdapterClass('DuplicateAdapter');
    const adapterB = createTestAdapterClass('DuplicateAdapter');

    for (const [ep, cls] of [
      [entryA, adapterA],
      [entryB, adapterB],
    ] as const) {
      const parse = await parseOrFail(parser, ep as string, 'export const adapterDefinition = defineAdapter({ adapter: Adapter });');
      const analysis: FileAnalysis = {
        filePath: ep as string,
        classes: [cls],
        reExports: parse.reExports,
        exports: parse.exports,
        exportedValues: { adapterDefinition: wrapDefineAdapter(buildAdapterConfig({ __zipbul_ref: cls.className })) },
      };

      applyParseToAnalysis(analysis, parse);
      fileMap.set(ep as string, analysis);
    }

    const resolver = new AdapterDefinitionResolver();

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

  it('should sort adapterStaticSchemas alphabetically', async () => {
    // Arrange
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();
    const entryA = join(projectRoot, 'adapters', 'a', 'index.ts');
    const entryB = join(projectRoot, 'adapters', 'b', 'index.ts');

    // Controller for alpha
    const controllerParse = await parseOrFail(parser, controllerFile, controllerCode);
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
    const controllerParseB = await parseOrFail(parser, controllerFileB, controllerCodeB);
    const controllerAnalysisB: FileAnalysis = {
      filePath: controllerFileB,
      classes: controllerParseB.classes,
      reExports: controllerParseB.reExports,
      exports: controllerParseB.exports,
      importEntries: [{ source: '@test/b', resolvedSource: entryB, isRelative: false }],
    };

    applyParseToAnalysis(controllerAnalysisB, controllerParseB);
    fileMap.set(controllerFileB, controllerAnalysisB);

    // Adapter 'Bravo' registered first alphabetically in entry paths, but className starts with 'B'
    const adapterBravo = createTestAdapterClass('BravoAdapter', {
      decorators: {
        controller: { __zipbul_ref: 'WsGateway' },
        handlers: [{ __zipbul_ref: 'OnMessage' }],
      },
    });
    const adapterAlpha = createTestAdapterClass('AlphaAdapter');

    // entryA → alpha, entryB → bravo
    for (const [ep, cls] of [
      [entryA, adapterAlpha],
      [entryB, adapterBravo],
    ] as const) {
      const parse = await parseOrFail(parser, ep as string, 'export const adapterDefinition = defineAdapter({ adapter: Adapter });');
      const analysis: FileAnalysis = {
        filePath: ep as string,
        classes: [cls],
        reExports: parse.reExports,
        exports: parse.exports,
        exportedValues: { adapterDefinition: wrapDefineAdapter(buildAdapterConfig({ __zipbul_ref: cls.className })) },
      };

      applyParseToAnalysis(analysis, parse);
      fileMap.set(ep as string, analysis);
    }

    addTestPhaseEnum(fileMap);

    const resolver = new AdapterDefinitionResolver();

    // Act
    const result = await resolver.resolve({ fileMap, projectRoot });

    // Assert — alphabetical order
    expect(Object.keys(result.adapterStaticSchemas)).toEqual(['AlphaAdapter', 'BravoAdapter']);
  });

  it('should sort handler index alphabetically', async () => {
    // Arrange — two controllers for the same adapter, different file paths and routes
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();

    const controllerFileZ = join(srcDir, 'z-controller.ts');
    const controllerFileA = join(srcDir, 'a-controller.ts');

    const controllerCodeZ = [
      'function Controller() { return () => {}; }',
      'function Get() { return () => {}; }',
      '',
      "@Controller('/z')",
      'class SampleControllerZ {',
      '  @Get()',
      '  handle() {}',
      '}',
    ].join('\n');

    const controllerCodeA = [
      'function Controller() { return () => {}; }',
      'function Get() { return () => {}; }',
      '',
      "@Controller('/a')",
      'class SampleControllerA {',
      '  @Get()',
      '  handle() {}',
      '}',
    ].join('\n');

    const controllerSources: [string, string][] = [
      [controllerFileZ, controllerCodeZ],
      [controllerFileA, controllerCodeA],
    ];

    for (const [file, source] of controllerSources) {
      const controllerParse = await parseOrFail(parser, file, source);
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

    const adapterClass = createTestAdapterClass();
    const entryParse = await parseOrFail(parser, entryFile, 'export const adapterDefinition = defineAdapter({ adapter: TestAdapter });');
    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: [adapterClass],
      reExports: entryParse.reExports,
      exports: entryParse.exports,
      exportedValues: { adapterDefinition: wrapDefineAdapter(buildAdapterConfig({ __zipbul_ref: 'TestAdapter' })) },
    };

    applyParseToAnalysis(entryAnalysis, entryParse);
    fileMap.set(entryFile, entryAnalysis);

    addTestPhaseEnum(fileMap);

    const resolver = new AdapterDefinitionResolver();

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

  const buildFileMapWithCode = async (
    controllerSource: string,
    adapterClass: ClassMetadata = createTestAdapterClass(),
  ): Promise<Map<string, FileAnalysis>> => {
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();

    const controllerParse = await parseOrFail(parser, controllerFile, controllerSource);
    const controllerAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: controllerParse.classes,
      reExports: controllerParse.reExports,
      exports: controllerParse.exports,
      importEntries: [{ source: '@test/adapter', resolvedSource: entryFile, isRelative: false }],
    };

    applyParseToAnalysis(controllerAnalysis, controllerParse);
    fileMap.set(controllerFile, controllerAnalysis);

    const entryParse = await parseOrFail(parser, entryFile, 'export const adapterDefinition = defineAdapter({ adapter: TestAdapter });');
    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: [adapterClass],
      reExports: entryParse.reExports,
      exports: entryParse.exports,
      exportedValues: { adapterDefinition: wrapDefineAdapter(buildAdapterConfig({ __zipbul_ref: adapterClass.className })) },
    };

    applyParseToAnalysis(entryAnalysis, entryParse);
    fileMap.set(entryFile, entryAnalysis);

    const enumFile = join(adapterDir, 'enums.ts');
    const enumAnalysis: FileAnalysis = {
      filePath: enumFile,
      classes: [],
      reExports: [],
      exports: ['TestPhase'],
      enums: new Map([['TestPhase', new Map([
        ['OnReceive', 'OnReceive'],
        ['PostParse', 'PostParse'],
        ['PreHandle', 'PreHandle'],
        ['OnComplete', 'OnComplete'],
      ])]]),
    };
    fileMap.set(enumFile, enumAnalysis);

    return fileMap;
  };

  it('should resolve controller with adapterNames filtering when multiple adapters share decorator name', async () => {
    // Arrange — two adapters both use 'Controller', adapterNames=['TestAdapter'] filters to one
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();
    const otherEntryFile = join(projectRoot, 'adapters', 'other-adapter', 'index.ts');

    const code = [
      'function Controller() { return () => {}; }',
      'function Get() { return () => {}; }',
      '',
      '@Controller({ adapterNames: ["TestAdapter"] })',
      'class FilteredController {',
      '  @Get()',
      '  handle() {}',
      '}',
    ].join('\n');

    const ctrlParse = await parseOrFail(parser, controllerFile, code);
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
    const testClass = createTestAdapterClass();
    const testParse = await parseOrFail(parser, entryFile, 'export const adapterDefinition = defineAdapter({ adapter: TestAdapter });');
    const testEntry: FileAnalysis = {
      filePath: entryFile,
      classes: [testClass],
      reExports: testParse.reExports,
      exports: testParse.exports,
      exportedValues: { adapterDefinition: wrapDefineAdapter(buildAdapterConfig({ __zipbul_ref: 'TestAdapter' })) },
    };

    applyParseToAnalysis(testEntry, testParse);
    fileMap.set(entryFile, testEntry);

    // Adapter 'other' (same controller decorator name 'Controller')
    const otherClass = createTestAdapterClass('OtherAdapter');
    const otherParse = await parseOrFail(parser, otherEntryFile, 'export const adapterDefinition = defineAdapter({ adapter: OtherAdapter });');
    const otherEntry: FileAnalysis = {
      filePath: otherEntryFile,
      classes: [otherClass],
      reExports: otherParse.reExports,
      exports: otherParse.exports,
      exportedValues: { adapterDefinition: wrapDefineAdapter(buildAdapterConfig({ __zipbul_ref: 'OtherAdapter' })) },
    };

    applyParseToAnalysis(otherEntry, otherParse);
    fileMap.set(otherEntryFile, otherEntry);

    addTestPhaseEnum(fileMap);

    const resolver = new AdapterDefinitionResolver();

    // Act
    const result = await resolver.resolve({ fileMap, projectRoot });

    // Assert — only 'TestAdapter' adapter handler should appear
    expect(result.handlerIndex.length).toBe(1);
    expect(result.handlerIndex[0]!.id).toContain('TestAdapter:');
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

    const fileMap = await buildFileMapWithCode(code);
    const resolver = new AdapterDefinitionResolver();

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

    const fileMap = await buildFileMapWithCode(code);
    const resolver = new AdapterDefinitionResolver();

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

    const fileMap = await buildFileMapWithCode(code);
    const resolver = new AdapterDefinitionResolver();

    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/private/i);
    }
  });

  it('should throw when adapterNames is not an array', async () => {
    const code = [
      'function Controller() { return () => {}; }',
      'function Get() { return () => {}; }',
      '',
      '@Controller({ adapterNames: "TestAdapter" })',
      'class BadAdapterNames {',
      '  @Get()',
      '  handle() {}',
      '}',
    ].join('\n');

    const fileMap = await buildFileMapWithCode(code);
    const resolver = new AdapterDefinitionResolver();

    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/adapterNames/);
    }
  });

  it('should throw when adapterNames is empty array', async () => {
    const code = [
      'function Controller() { return () => {}; }',
      'function Get() { return () => {}; }',
      '',
      '@Controller({ adapterNames: [] })',
      'class EmptyAdapterNames {',
      '  @Get()',
      '  handle() {}',
      '}',
    ].join('\n');

    const fileMap = await buildFileMapWithCode(code);
    const resolver = new AdapterDefinitionResolver();

    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/adapterNames/);
    }
  });

  it('should throw when adapterNames element is not a string', async () => {
    const code = [
      'function Controller() { return () => {}; }',
      'function Get() { return () => {}; }',
      '',
      '@Controller({ adapterNames: [42] })',
      'class NumericAdapterName {',
      '  @Get()',
      '  handle() {}',
      '}',
    ].join('\n');

    const fileMap = await buildFileMapWithCode(code);
    const resolver = new AdapterDefinitionResolver();

    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/adapterNames/);
    }
  });

  it('should throw when adapterNames contains unknown adapter name', async () => {
    const code = [
      'function Controller() { return () => {}; }',
      'function Get() { return () => {}; }',
      '',
      '@Controller({ adapterNames: ["nonexistent"] })',
      'class UnknownAdapterName {',
      '  @Get()',
      '  handle() {}',
      '}',
    ].join('\n');

    const fileMap = await buildFileMapWithCode(code);
    const resolver = new AdapterDefinitionResolver();

    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/nonexistent/);
    }
  });

  it('should resolve adapter when exported as legacy adapterSpec name', async () => {
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();
    const adapterClass = createTestAdapterClass();

    // Controller file
    const controllerParse = await parseOrFail(parser, controllerFile, controllerCode);
    const controllerAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: controllerParse.classes,
      reExports: controllerParse.reExports,
      exports: controllerParse.exports,
      importEntries: [{ source: '@test/adapter', resolvedSource: entryFile, isRelative: false }],
    };

    applyParseToAnalysis(controllerAnalysis, controllerParse);
    fileMap.set(controllerFile, controllerAnalysis);

    // Entry file using legacy 'adapterSpec' export name
    const entryParse = await parseOrFail(parser, entryFile, 'export const adapterSpec = defineAdapter({ adapter: TestAdapter });');
    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: [adapterClass],
      reExports: entryParse.reExports,
      exports: entryParse.exports,
      exportedValues: { adapterSpec: wrapDefineAdapter(buildAdapterConfig({ __zipbul_ref: adapterClass.className })) },
    };

    applyParseToAnalysis(entryAnalysis, entryParse);
    fileMap.set(entryFile, entryAnalysis);

    addTestPhaseEnum(fileMap);

    const resolver = new AdapterDefinitionResolver();
    const result = await resolver.resolve({ fileMap, projectRoot });

    expect(isErr(result)).toBe(false);
  });

  // =======================================================================
  // extractDecoratorRefKeys (tested indirectly via buildHandlerIndex)
  // =======================================================================

  describe('extractDecoratorRefKeys', () => {
    it('should return empty middlewareKeys when handler has no UseMiddlewares decorator', async () => {
      // Arrange
      const code = [
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        '',
        '@Controller()',
        'class PlainController {',
        '  @Get()',
        '  handle() {}',
        '}',
      ].join('\n');

      const fileMap = await buildFileMapWithCode(code);
      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert
      const entry = result.handlerIndex[0];

      expect(entry).toBeDefined();
      expect(entry!.middlewareKeys).toBeUndefined();
      expect(result.routeRegistrations).toEqual([]);
    });

    it('should populate middlewareKeys from class-level UseMiddlewares decorator', async () => {
      // Arrange
      const code = [
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        'function UseMiddlewares() { return () => {}; }',
        'function AuthMw() {}',
        '',
        '@Controller()',
        "@UseMiddlewares('PreHandle', [AuthMw])",
        'class ClassMwController {',
        '  @Get()',
        '  handle() {}',
        '}',
      ].join('\n');

      const fileMap = await buildFileMapWithCode(code);
      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert
      const entry = result.handlerIndex[0];

      expect(entry).toBeDefined();
      expect(entry!.middlewareKeys).toBeDefined();
      expect(entry!.middlewareKeys!.length).toBe(1);
      expect(entry!.middlewareKeys![0]).toContain(':cls:');
    });

    it('should populate middlewareKeys from method-level UseMiddlewares decorator', async () => {
      // Arrange
      const code = [
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        'function UseMiddlewares() { return () => {}; }',
        'function LogMw() {}',
        '',
        '@Controller()',
        'class MethodMwController {',
        '  @Get()',
        "  @UseMiddlewares('PreHandle', [LogMw])",
        '  handle() {}',
        '}',
      ].join('\n');

      const fileMap = await buildFileMapWithCode(code);
      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert
      const entry = result.handlerIndex[0];

      expect(entry).toBeDefined();
      expect(entry!.middlewareKeys).toBeDefined();
      expect(entry!.middlewareKeys!.length).toBe(1);
      expect(entry!.middlewareKeys![0]).toContain(':mtd:');
    });

    it('should merge class-level before method-level (order preserved)', async () => {
      // Arrange
      const code = [
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        'function UseMiddlewares() { return () => {}; }',
        'function AuthMw() {}',
        'function LogMw() {}',
        '',
        '@Controller()',
        "@UseMiddlewares('PreHandle', [AuthMw])",
        'class MergedController {',
        '  @Get()',
        "  @UseMiddlewares('PreHandle', [LogMw])",
        '  handle() {}',
        '}',
      ].join('\n');

      const fileMap = await buildFileMapWithCode(code);
      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert
      const entry = result.handlerIndex[0];

      expect(entry).toBeDefined();
      expect(entry!.middlewareKeys).toBeDefined();
      expect(entry!.middlewareKeys!.length).toBe(2);
      expect(entry!.middlewareKeys![0]).toContain(':cls:0');
      expect(entry!.middlewareKeys![1]).toContain(':mtd:1');
    });

    it('should handle multiple arguments in single decorator', async () => {
      // Arrange
      const code = [
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        'function UseMiddlewares() { return () => {}; }',
        'function MwA() {}',
        'function MwB() {}',
        '',
        '@Controller()',
        'class MultiArgController {',
        '  @Get()',
        "  @UseMiddlewares('PreHandle', [MwA, MwB])",
        '  handle() {}',
        '}',
      ].join('\n');

      const fileMap = await buildFileMapWithCode(code);
      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert
      const entry = result.handlerIndex[0];

      expect(entry).toBeDefined();
      expect(entry!.middlewareKeys).toBeDefined();
      expect(entry!.middlewareKeys!.length).toBe(2);
      expect(entry!.middlewareKeys![0]).toContain(':mtd:0');
      expect(entry!.middlewareKeys![1]).toContain(':mtd:1');
    });

    it('should skip non-matching decorator names', async () => {
      // Arrange
      const code = [
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        'function SomeOther() { return () => {}; }',
        'function AuthMw() {}',
        '',
        '@Controller()',
        'class OtherDecController {',
        '  @Get()',
        '  @SomeOther(AuthMw)',
        '  handle() {}',
        '}',
      ].join('\n');

      const fileMap = await buildFileMapWithCode(code);
      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert
      const entry = result.handlerIndex[0];

      expect(entry).toBeDefined();
      expect(entry!.middlewareKeys).toBeUndefined();
    });

    it('should skip arguments without __zipbul_ref', async () => {
      // Arrange — string literal arguments in the refs array do not produce __zipbul_ref records
      const code = [
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        'function UseMiddlewares() { return () => {}; }',
        '',
        '@Controller()',
        'class StringArgController {',
        '  @Get()',
        '  @UseMiddlewares("PreHandle", ["not-a-ref"])',
        '  handle() {}',
        '}',
      ].join('\n');

      const fileMap = await buildFileMapWithCode(code);
      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert
      const entry = result.handlerIndex[0];

      expect(entry).toBeDefined();
      expect(entry!.middlewareKeys).toBeUndefined();
      expect(result.routeRegistrations).toEqual([]);
    });

    it('should produce deterministic key format with cls/mtd prefix', async () => {
      // Arrange
      const code = [
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        'function UseMiddlewares() { return () => {}; }',
        'function GlobalMw() {}',
        'function RouteMw() {}',
        '',
        '@Controller()',
        "@UseMiddlewares('PreHandle', [GlobalMw])",
        'class KeyFormatController {',
        '  @Get()',
        "  @UseMiddlewares('PreHandle', [RouteMw])",
        '  handle() {}',
        '}',
      ].join('\n');

      const fileMap = await buildFileMapWithCode(code);
      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert
      const entry = result.handlerIndex[0];
      const prefix = '__route_mw__:KeyFormatController.handle';

      expect(entry).toBeDefined();
      expect(entry!.middlewareKeys![0]).toBe(`${prefix}:cls:0`);
      expect(entry!.middlewareKeys![1]).toBe(`${prefix}:mtd:1`);
    });

    it('should accumulate routeRegistrations with key-value pairs', async () => {
      // Arrange
      const code = [
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        'function UseMiddlewares() { return () => {}; }',
        'function AuthMw() {}',
        '',
        '@Controller()',
        'class RegController {',
        '  @Get()',
        "  @UseMiddlewares('PreHandle', [AuthMw])",
        '  handle() {}',
        '}',
      ].join('\n');

      const fileMap = await buildFileMapWithCode(code);
      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert
      const mwRegistrations = result.routeRegistrations.filter(reg => reg.key.includes('__route_mw__'));

      expect(mwRegistrations.length).toBe(1);
      expect(mwRegistrations[0]!.key).toContain('RegController.handle');

      const value = mwRegistrations[0]!.value as Record<string, unknown>;

      expect(value.__zipbul_ref).toBe('AuthMw');
    });

    it('should preserve global and route pipeline bindings losslessly for generic pipeline IR', async () => {
      const code = [
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        'function UseMiddlewares() { return () => {}; }',
        'function UseGuards() { return () => {}; }',
        'function RouteMw() {}',
        '',
        '@Controller()',
        'class BindingController {',
        '  @Get()',
        "  @UseMiddlewares('OnReceive', [RouteMw])",
        '  @UseGuards(RouteMw)',
        '  handle() {}',
        '}',
      ].join('\n');

      const fileMap = await buildFileMapWithCode(code);
      fileMap.set('/project/app/__module__.ts', {
        filePath: '/project/app/__module__.ts',
        classes: [],
        reExports: [],
        exports: [],
        defineModuleCalls: [],
        imports: {},
        moduleDefinition: {
          name: 'AppModule',
          providers: [],
          imports: {},
          adapters: [{
            adapter: { __zipbul_ref: 'TestAdapter' },
            middlewares: { OnReceive: [{ __zipbul_ref: 'RouteMw' }] },
            guards: [{ __zipbul_ref: 'RouteMw' }],
            exceptionFilters: [{ __zipbul_ref: 'RouteMw' }],
          }],
        },
      });
      const resolver = new AdapterDefinitionResolver();
      const graph = {
        classMap: new Map([[
          'BindingController',
          {
            name: 'AppModule',
          },
        ]]),
        registerControllers() {},
      } as unknown;

      const result = await resolver.resolve({ fileMap, projectRoot, graph: graph as never });
      const entry = result.handlerIndex[0];

      expect(entry?.ownerModuleName).toBe('AppModule');
      expect(entry?.middlewareBindings?.map(binding => binding.scope)).toEqual(['global', 'handler']);
      expect(entry?.middlewareBindings?.[0]?.phase).toBe('OnReceive');
      expect(entry?.middlewareBindings?.[1]?.phase).toBe('OnReceive');
      expect(entry?.mergedPhaseMiddlewareKeys).toEqual({
        OnReceive: [
          '__global_mw__:AppModule:TestAdapter:OnReceive:0',
          '__route_mw__:BindingController.handle:mtd:0',
        ],
      });
      expect(entry?.guardBindings?.map(binding => binding.scope)).toEqual(['global', 'handler']);
      expect(entry?.mergedGuardKeys).toEqual([
        '__global_gd__:AppModule:TestAdapter:0',
        '__route_gd__:BindingController.handle:mtd:0',
      ]);
      expect(entry?.exceptionFilterBindings?.map(binding => binding.scope)).toEqual(['global']);
      expect(entry?.mergedExceptionFilterKeys).toEqual(['__global_ef__:AppModule:TestAdapter:0']);
      expect(result.routeRegistrations.some(reg => reg.key.startsWith('__global_mw__:AppModule:TestAdapter:OnReceive:'))).toBe(true);
      expect(result.routeRegistrations.some(reg => reg.key.startsWith('__global_gd__:AppModule:TestAdapter:'))).toBe(true);
      expect(result.routeRegistrations.some(reg => reg.key.startsWith('__global_ef__:AppModule:TestAdapter:'))).toBe(true);
    });

    it('should return error when @UseMiddlewares has no arguments', async () => {
      // Arrange — @UseMiddlewares() with no arguments is an error in phase-aware form
      const code = [
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        'function UseMiddlewares() { return () => {}; }',
        '',
        '@Controller()',
        'class EmptyArgController {',
        '  @Get()',
        '  @UseMiddlewares()',
        '  handle() {}',
        '}',
      ].join('\n');

      const fileMap = await buildFileMapWithCode(code);
      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert — phase-aware @UseMiddlewares requires (phaseId, refs) or ({ [phaseId]: refs })
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.why).toMatch(/UseMiddlewares/);
      }
    });

    it('should merge keys when both class and method have same decorator type', async () => {
      // Arrange
      const code = [
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        'function UseGuards() { return () => {}; }',
        'function AdminGuard() {}',
        'function RoleGuard() {}',
        '',
        '@Controller()',
        '@UseGuards(AdminGuard)',
        'class DualGuardController {',
        '  @Get()',
        '  @UseGuards(RoleGuard)',
        '  handle() {}',
        '}',
      ].join('\n');

      const fileMap = await buildFileMapWithCode(code);
      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert
      const entry = result.handlerIndex[0];

      expect(entry).toBeDefined();
      expect(entry!.guardKeys).toBeDefined();
      expect(entry!.guardKeys!.length).toBe(2);
      expect(entry!.guardKeys![0]).toContain(':cls:0');
      expect(entry!.guardKeys![1]).toContain(':mtd:1');
    });

    it('should not process @Middlewares (old name) decorator — only UseMiddlewares', async () => {
      // Arrange — @Middlewares is the old name, not handled by extractMiddlewaresDecoratorRefKeys
      const code = [
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        'function Middlewares() { return () => {}; }',
        'function AuthMw() {}',
        '',
        '@Controller()',
        'class PhaseAwareController {',
        '  @Get()',
        '  @Middlewares("OnReceive", [AuthMw])',
        '  handle() {}',
        '}',
      ].join('\n');

      const fileMap = await buildFileMapWithCode(code);
      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert
      const entry = result.handlerIndex[0];

      expect(entry).toBeDefined();
      expect(entry!.middlewareKeys).toBeUndefined();
    });
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

    const fileMap = await buildFileMapWithCode(code);
    const resolver = new AdapterDefinitionResolver();

    // isStatic check should fire first, not isPrivateName
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/static/i);
    }
  });

  // =======================================================================
  // Build-time validation (BV)
  // =======================================================================

  describe('build-time validation', () => {
    // C-3: Unresolvable expression in @UseGuards → throw
    it('should throw when @UseGuards argument is an unresolvable expression', async () => {
      // Arrange — manually construct metadata with ZIPBUL_UNRESOLVABLE marker
      const fileMap = new Map<string, FileAnalysis>();

      const unresolvableArg: AnalyzerValueRecord = {
        [ZIPBUL_UNRESOLVABLE]: true,
        nodeType: 'ConditionalExpression',
        start: 0,
        end: 10,
      };

      const controllerAnalysis: FileAnalysis = {
        filePath: controllerFile,
        classes: [
          {
            className: 'GuardedController',
            decorators: [{ name: 'Controller', arguments: [] }],
            methods: [
              {
                name: 'handle',
                decorators: [
                  { name: 'Get', arguments: [] },
                  { name: 'UseGuards', arguments: [unresolvableArg] },
                ],
              },
            ],
          },
        ],
        reExports: [],
        exports: [],
        importEntries: [{ source: '@test/adapter', resolvedSource: entryFile, isRelative: false }],
      };

      fileMap.set(controllerFile, controllerAnalysis);

      const adapterClass = createTestAdapterClass();
      const entryAnalysis: FileAnalysis = {
        filePath: entryFile,
        classes: [adapterClass],
        reExports: [],
        exports: ['adapterDefinition'],
        exportedValues: { adapterDefinition: wrapDefineAdapter(buildAdapterConfig({ __zipbul_ref: 'TestAdapter' })) },
      };

      fileMap.set(entryFile, entryAnalysis);

      addTestPhaseEnum(fileMap);

      const resolver = new AdapterDefinitionResolver();

      // Act & Assert
      await expect(resolver.resolve({ fileMap, projectRoot })).rejects.toThrow(/must be a statically resolvable identifier/);
    });

    // D-3: Route path conflict detection
    it('should return diagnostic error when two handlers map to the same HTTP method and path', async () => {
      // Arrange — two controllers both define GET /users
      const parser = new AstParser();
      const fileMap = new Map<string, FileAnalysis>();

      const controllerFileA = join(srcDir, 'controller-a.ts');
      const controllerFileB = join(srcDir, 'controller-b.ts');

      const codeA = [
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        '',
        '@Controller()',
        'class ControllerA {',
        "  @Get('/users')",
        '  listUsers() {}',
        '}',
      ].join('\n');

      const codeB = [
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        '',
        '@Controller()',
        'class ControllerB {',
        "  @Get('/users')",
        '  fetchUsers() {}',
        '}',
      ].join('\n');

      for (const [file, source] of [[controllerFileA, codeA], [controllerFileB, codeB]] as const) {
        const controllerParse = await parseOrFail(parser, file, source);
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

      const adapterClass = createTestAdapterClass();
      const entryParse = await parseOrFail(parser, entryFile, 'export const adapterDefinition = defineAdapter({ adapter: TestAdapter });');
      const entryAnalysis: FileAnalysis = {
        filePath: entryFile,
        classes: [adapterClass],
        reExports: entryParse.reExports,
        exports: entryParse.exports,
        exportedValues: { adapterDefinition: wrapDefineAdapter(buildAdapterConfig({ __zipbul_ref: 'TestAdapter' })) },
      };

      applyParseToAnalysis(entryAnalysis, entryParse);
      fileMap.set(entryFile, entryAnalysis);

      addTestPhaseEnum(fileMap);

      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.why).toMatch(/Route conflict/);
      }
    });

    // D-4: Controller with no handlers → warning
    it('should warn when a controller has no handler methods', async () => {
      // Arrange — controller with @Controller but no @Get/@Post etc.
      // Use spyOn on the actual Logger instance created at module level.
      // Logger.prototype.warn may be polluted by mock.module in other test files,
      // so we intercept via a fresh resolver and check the result diagnostics instead.

      const code = [
        'function Controller() { return () => {}; }',
        '',
        '@Controller()',
        'class EmptyController {',
        '  someMethod() {}',
        '}',
      ].join('\n');

      const fileMap = await buildFileMapWithCode(code);
      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert — the resolver still produces a valid result (warning, not error)
      // The warning is logged but does not affect the return value.
      // Verify that the controller was detected but has no handlers registered.
      expect(result.handlerIndex).toHaveLength(0);
    });

    // D-5: Multiple route decorators on same method → error
    it('should return diagnostic error when handler has multiple route decorators', async () => {
      // Arrange — method has both @Get and @Post
      const fileMap = new Map<string, FileAnalysis>();

      const controllerAnalysis: FileAnalysis = {
        filePath: controllerFile,
        classes: [
          {
            className: 'MultiRouteController',
            decorators: [{ name: 'Controller', arguments: [] }],
            methods: [
              {
                name: 'handle',
                decorators: [
                  { name: 'Get', arguments: [] },
                  { name: 'Post', arguments: [] },
                ],
              },
            ],
          },
        ],
        reExports: [],
        exports: [],
        importEntries: [{ source: '@test/adapter', resolvedSource: entryFile, isRelative: false }],
      };

      fileMap.set(controllerFile, controllerAnalysis);

      const adapterClass = createTestAdapterClass('TestAdapter', {
        decorators: {
          controller: { __zipbul_ref: 'Controller' },
          handlers: [{ __zipbul_ref: 'Get' }, { __zipbul_ref: 'Post' }],
        },
      });
      const entryAnalysis: FileAnalysis = {
        filePath: entryFile,
        classes: [adapterClass],
        reExports: [],
        exports: ['adapterDefinition'],
        exportedValues: { adapterDefinition: wrapDefineAdapter(buildAdapterConfig({ __zipbul_ref: 'TestAdapter' })) },
      };

      fileMap.set(entryFile, entryAnalysis);

      addTestPhaseEnum(fileMap);

      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.data.why).toMatch(/multiple route decorators/);
      }
    });

  });

  // =======================================================================
  // Options extraction (tested indirectly via buildHandlerIndex)
  // =======================================================================

  describe('extractOptionDecorators', () => {
    it('should include options when method has option decorator', async () => {
      // Arrange — adapter declares RawBody as option decorator, method uses it
      const code = [
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        'function RawBody() { return () => {}; }',
        '',
        '@Controller()',
        'class OptionController {',
        '  @Get()',
        '  @RawBody()',
        '  handle() {}',
        '}',
      ].join('\n');

      const adapterClass = createTestAdapterClass('TestAdapter', {
        decorators: {
          controller: { __zipbul_ref: 'Controller' },
          handlers: [{ __zipbul_ref: 'Get' }],
          options: [{ __zipbul_ref: 'RawBody' }],
        },
      });
      const fileMap = await buildFileMapWithCode(code, adapterClass);
      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert
      const entry = result.handlerIndex[0];

      expect(entry).toBeDefined();
      expect(entry!.options).toEqual([{ name: 'RawBody', arguments: [] }]);
    });

    it('should have no options field when no option decorators present', async () => {
      // Arrange — adapter declares options but handler does not use any
      const code = [
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        'function RawBody() { return () => {}; }',
        '',
        '@Controller()',
        'class PlainController {',
        '  @Get()',
        '  handle() {}',
        '}',
      ].join('\n');

      const adapterClass = createTestAdapterClass('TestAdapter', {
        decorators: {
          controller: { __zipbul_ref: 'Controller' },
          handlers: [{ __zipbul_ref: 'Get' }],
          options: [{ __zipbul_ref: 'RawBody' }],
        },
      });
      const fileMap = await buildFileMapWithCode(code, adapterClass);
      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert
      const entry = result.handlerIndex[0];

      expect(entry).toBeDefined();
      expect(entry!.options).toBeUndefined();
    });

    it('should apply class-level option decorator to all handler methods', async () => {
      // Arrange — RawBody on the class applies to every handler
      const code = [
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        'function RawBody() { return () => {}; }',
        '',
        '@Controller()',
        '@RawBody()',
        'class ClassOptionController {',
        "  @Get('/a')",
        '  handleA() {}',
        '',
        "  @Get('/b')",
        '  handleB() {}',
        '}',
      ].join('\n');

      const adapterClass = createTestAdapterClass('TestAdapter', {
        decorators: {
          controller: { __zipbul_ref: 'Controller' },
          handlers: [{ __zipbul_ref: 'Get' }],
          options: [{ __zipbul_ref: 'RawBody' }],
        },
      });
      const fileMap = await buildFileMapWithCode(code, adapterClass);
      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert — both handlers have the class-level option
      expect(result.handlerIndex.length).toBe(2);

      for (const entry of result.handlerIndex) {
        expect(entry.options).toEqual([{ name: 'RawBody', arguments: [] }]);
      }
    });

    it('should override class-level option with method-level option of same name', async () => {
      // Arrange — class has @RawBody('gzip'), method overrides with @RawBody('deflate')
      const code = [
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        'function RawBody() { return () => {}; }',
        '',
        '@Controller()',
        "@RawBody('gzip')",
        'class OverrideController {',
        '  @Get()',
        "  @RawBody('deflate')",
        '  handle() {}',
        '}',
      ].join('\n');

      const adapterClass = createTestAdapterClass('TestAdapter', {
        decorators: {
          controller: { __zipbul_ref: 'Controller' },
          handlers: [{ __zipbul_ref: 'Get' }],
          options: [{ __zipbul_ref: 'RawBody' }],
        },
      });
      const fileMap = await buildFileMapWithCode(code, adapterClass);
      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert — method-level overrides class-level
      const entry = result.handlerIndex[0];

      expect(entry).toBeDefined();
      expect(entry!.options).toEqual([{ name: 'RawBody', arguments: ['deflate'] }]);
    });

    it('should include decorator arguments in options', async () => {
      // Arrange — option decorator with arguments
      const code = [
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        'function RawBody() { return () => {}; }',
        '',
        '@Controller()',
        'class ArgController {',
        '  @Get()',
        "  @RawBody('gzip', 1024)",
        '  handle() {}',
        '}',
      ].join('\n');

      const adapterClass = createTestAdapterClass('TestAdapter', {
        decorators: {
          controller: { __zipbul_ref: 'Controller' },
          handlers: [{ __zipbul_ref: 'Get' }],
          options: [{ __zipbul_ref: 'RawBody' }],
        },
      });
      const fileMap = await buildFileMapWithCode(code, adapterClass);
      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert
      const entry = result.handlerIndex[0];

      expect(entry).toBeDefined();
      expect(entry!.options).toEqual([{ name: 'RawBody', arguments: ['gzip', 1024] }]);
    });
  });

  // =======================================================================
  // ctx.validated extraction — REMOVED (API deleted in HttpContext DX redesign)
  // ValidatedAccessors tests removed along with ctx.validated() API.
  // New DX uses ctx.request.getBody(Dto), ctx.request.getParams(Dto).

  describe.skip('ctx.validated extraction [REMOVED]', () => {
    it('should produce validation entry for ctx.validated(bodyInput, UserDto)', async () => {
      // Arrange — handler calls ctx.validated(bodyInput, UserDto)
      const code = [
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        'class UserDto {}',
        'const bodyInput = Symbol();',
        '',
        '@Controller()',
        'class BodyController {',
        '  @Get()',
        '  handle(ctx: any) {',
        '    const body = ctx.validated(bodyInput, UserDto);',
        '  }',
        '}',
      ].join('\n');

      const fileMap = await buildFileMapWithCode(code);
      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert
      const entry = result.handlerIndex[0];

      expect(entry).toBeDefined();
      expect(entry!.validations).toEqual([{ keyRef: 'bodyInput', metatypeKey: 'UserDto' }]);
    });

    it('should produce validation entry for ctx.validated(queryInput, SearchDto)', async () => {
      // Arrange — handler calls ctx.validated(queryInput, SearchDto)
      const code = [
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        'class SearchDto {}',
        'const queryInput = Symbol();',
        '',
        '@Controller()',
        'class QueryController {',
        '  @Get()',
        '  handle(ctx: any) {',
        '    const query = ctx.validated(queryInput, SearchDto);',
        '  }',
        '}',
      ].join('\n');

      const fileMap = await buildFileMapWithCode(code);
      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert
      const entry = result.handlerIndex[0];

      expect(entry).toBeDefined();
      expect(entry!.validations).toEqual([{ keyRef: 'queryInput', metatypeKey: 'SearchDto' }]);
    });

    it('should produce multiple validation entries for multiple validated calls', async () => {
      // Arrange — handler calls validated with different keys and DTOs
      const code = [
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        'class UserDto {}',
        'class SearchDto {}',
        'const bodyInput = Symbol();',
        'const queryInput = Symbol();',
        '',
        '@Controller()',
        'class MultiController {',
        '  @Get()',
        '  handle(ctx: any) {',
        '    const body = ctx.validated(bodyInput, UserDto);',
        '    const query = ctx.validated(queryInput, SearchDto);',
        '  }',
        '}',
      ].join('\n');

      const fileMap = await buildFileMapWithCode(code);
      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert
      const entry = result.handlerIndex[0];

      expect(entry).toBeDefined();
      expect(entry!.validations).toEqual([
        { keyRef: 'bodyInput', metatypeKey: 'UserDto' },
        { keyRef: 'queryInput', metatypeKey: 'SearchDto' },
      ]);
    });

    it('should deduplicate when same key is validated twice', async () => {
      // Arrange — handler calls validated(bodyInput, UserDto) twice
      const code = [
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        'class UserDto {}',
        'const bodyInput = Symbol();',
        '',
        '@Controller()',
        'class DuplicateController {',
        '  @Get()',
        '  handle(ctx: any) {',
        '    const bodyA = ctx.validated(bodyInput, UserDto);',
        '    const bodyB = ctx.validated(bodyInput, UserDto);',
        '  }',
        '}',
      ].join('\n');

      const fileMap = await buildFileMapWithCode(code);
      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert — deduplicated to a single entry
      const entry = result.handlerIndex[0];

      expect(entry).toBeDefined();
      expect(entry!.validations).toEqual([{ keyRef: 'bodyInput', metatypeKey: 'UserDto' }]);
    });

    it('should filter out never metatype argument', async () => {
      // Arrange — handler calls ctx.validated(bodyInput, never) — never ref filtered out
      // Note: never is a keyword, not an Identifier, so callArgs won't capture it.
      // buildValidationEntries requires callArgs.length >= 2, so this produces no validations.
      const code = [
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        'const bodyInput = Symbol();',
        '',
        '@Controller()',
        'class NeverController {',
        '  @Get()',
        '  handle(ctx: any) {',
        '    const body = ctx.validated(bodyInput);',
        '  }',
        '}',
      ].join('\n');

      const fileMap = await buildFileMapWithCode(code);
      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert — incomplete call (missing second arg) produces no validations
      const entry = result.handlerIndex[0];

      expect(entry).toBeDefined();
      expect(entry!.validations).toBeUndefined();
    });

    it('should produce a single validation entry when ctx.validated has both type args and call args', async () => {
      // Arrange — handler calls ctx.validated<UserDto>(bodyInput, UserDto)
      // This must produce exactly ONE entry, not two (type-args entry + call-args entry)
      const code = [
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        'const bodyInput = Symbol();',
        'class UserDto {}',
        '',
        '@Controller()',
        'class TypeArgController {',
        '  @Get()',
        '  handle(ctx: any) {',
        '    const body = ctx.validated<UserDto>(bodyInput, UserDto);',
        '  }',
        '}',
      ].join('\n');

      const fileMap = await buildFileMapWithCode(code);
      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert — exactly one validation entry, not duplicated
      const entry = result.handlerIndex[0];

      expect(entry).toBeDefined();
      expect(entry!.validations).toHaveLength(1);
      expect(entry!.validations![0]).toEqual({ keyRef: 'bodyInput', metatypeKey: 'UserDto' });
    });

    it('should include keyImportSource when context key is imported', async () => {
      // Arrange — handler imports bodyInput from another file
      const code = [
        'import { bodyInput } from "./keys";',
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        'class UserDto {}',
        '',
        '@Controller()',
        'class ImportedKeyController {',
        '  @Get()',
        '  handle(ctx: any) {',
        '    const body = ctx.validated(bodyInput, UserDto);',
        '  }',
        '}',
      ].join('\n');

      const fileMap = await buildFileMapWithCode(code);
      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert — keyImportSource should be set from import declaration
      const entry = result.handlerIndex[0];

      expect(entry).toBeDefined();
      expect(entry!.validations).toHaveLength(1);
      expect(entry!.validations![0]!.keyRef).toBe('bodyInput');
      expect(entry!.validations![0]!.keyImportSource).toBe('/project/src/keys');
    });

    it('should omit keyImportSource when context key is locally declared', async () => {
      // Arrange — bodyInput is declared locally (not imported)
      const code = [
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        'class UserDto {}',
        'const bodyInput = Symbol();',
        '',
        '@Controller()',
        'class LocalKeyController {',
        '  @Get()',
        '  handle(ctx: any) {',
        '    const body = ctx.validated(bodyInput, UserDto);',
        '  }',
        '}',
      ].join('\n');

      const fileMap = await buildFileMapWithCode(code);
      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert — keyImportSource should be undefined
      const entry = result.handlerIndex[0];

      expect(entry).toBeDefined();
      expect(entry!.validations).toHaveLength(1);
      expect(entry!.validations![0]!.keyImportSource).toBeUndefined();
    });

    it('should skip metatype refs that are any or unknown', async () => {
      // Arrange — handler calls ctx.validated(bodyInput, any) and ctx.validated(queryInput, unknown)
      // 'any' and 'unknown' are keywords, not identifiers — callArgs won't capture them.
      // But if they happen to be identifiers (unlikely), they should be filtered.
      const code = [
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        'const bodyInput = Symbol();',
        '',
        '@Controller()',
        'class FilteredController {',
        '  @Get()',
        '  handle(ctx: any) {',
        '    ctx.validated(bodyInput);',
        '  }',
        '}',
      ].join('\n');

      const fileMap = await buildFileMapWithCode(code);
      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert — no validations (single arg → callArgs.length < 2)
      const entry = result.handlerIndex[0];

      expect(entry).toBeDefined();
      expect(entry!.validations).toBeUndefined();
    });

    it('should produce no validations when handler has no validated calls', async () => {
      // Arrange — handler body has no ctx.validated() calls
      const code = [
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        '',
        '@Controller()',
        'class NoTypedCallController {',
        '  @Get()',
        '  handle(ctx: any) {',
        '    return "hello";',
        '  }',
        '}',
      ].join('\n');

      const fileMap = await buildFileMapWithCode(code);
      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert
      const entry = result.handlerIndex[0];

      expect(entry).toBeDefined();
      expect(entry!.validations).toBeUndefined();
    });

    it('should produce no validations when validated has fewer than two arguments', async () => {
      // Arrange — handler calls validated() with only one argument
      const code = [
        'function Controller() { return () => {}; }',
        'function Get(path: string) { return () => {}; }',
        'const bodyInput = Symbol();',
        '@Controller()',
        'class SampleController {',
        '  @Get("/test")',
        '  handle(ctx: any) { ctx.validated(bodyInput); }',
        '}',
      ].join('\n');

      const fileMap = await buildFileMapWithCode(code);
      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert
      const entry = result.handlerIndex[0];

      expect(entry).toBeDefined();
      expect(entry!.validations).toBeUndefined();
    });

    it('should extract validation from validated call inside if block', async () => {
      // Arrange — handler calls ctx.validated(bodyInput, UserDto) inside if block
      const code = [
        'function Controller() { return () => {}; }',
        'function Get(path: string) { return () => {}; }',
        'const bodyInput = Symbol();',
        '@Controller()',
        'class SampleController {',
        '  @Get("/test")',
        '  handle(ctx: any) { if (true) { ctx.validated(bodyInput, UserDto); } }',
        '}',
      ].join('\n');

      const fileMap = await buildFileMapWithCode(code);
      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert
      const entry = result.handlerIndex[0];

      expect(entry).toBeDefined();
      expect(entry!.validations).toBeDefined();
      expect(entry!.validations).toHaveLength(1);
      expect(entry!.validations![0]!.keyRef).toBe('bodyInput');
      expect(entry!.validations![0]!.metatypeKey).toBe('UserDto');
    });

    it('should produce no validations for non-validated method calls', async () => {
      // Arrange — handler calls someMethod(key, Dto) which is not 'validated'
      const code = [
        'function Controller() { return () => {}; }',
        'function Get(path: string) { return () => {}; }',
        'const bodyInput = Symbol();',
        '@Controller()',
        'class SampleController {',
        '  @Get("/test")',
        '  handle(ctx: any) { ctx.someMethod(bodyInput, UserDto); }',
        '}',
      ].join('\n');

      const fileMap = await buildFileMapWithCode(code);
      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });

      // Assert
      const entry = result.handlerIndex[0];

      expect(entry).toBeDefined();
      expect(entry!.validations).toBeUndefined();
    });

    it('should survive JSON serialization roundtrip (manifest simulation)', async () => {
      // Arrange — handler with ctx.validated calls for body and query
      const code = [
        'function Controller() { return () => {}; }',
        'function Get(path: string) { return () => {}; }',
        'const bodyInput = Symbol();',
        'const queryInput = Symbol();',
        '@Controller()',
        'class SampleController {',
        '  @Get("/search")',
        '  handle(ctx: any) {',
        '    const body = ctx.validated(bodyInput, UserDto);',
        '    const query = ctx.validated(queryInput, SearchDto);',
        '  }',
        '}',
      ].join('\n');

      const fileMap = await buildFileMapWithCode(code);
      const resolver = new AdapterDefinitionResolver();

      // Act — resolve, then simulate manifest serialization
      const result = await resolver.resolve({ fileMap, projectRoot });
      const serialized = JSON.stringify(result.handlerIndex);
      const deserialized = JSON.parse(serialized) as typeof result.handlerIndex;

      // Assert — validations survive roundtrip
      const entry = deserialized[0];

      expect(entry).toBeDefined();
      expect(entry!.validations).toBeDefined();
      expect(entry!.validations).toHaveLength(2);
      expect(entry!.validations![0]!.keyRef).toBe('bodyInput');
      expect(entry!.validations![0]!.metatypeKey).toBe('UserDto');
      expect(entry!.validations![1]!.keyRef).toBe('queryInput');
      expect(entry!.validations![1]!.metatypeKey).toBe('SearchDto');
    });

    it('should survive JSON serialization roundtrip with options', async () => {
      // Arrange — handler with @RawBody option and ctx.validated call
      const code = [
        'function Controller() { return () => {}; }',
        'function Post(path: string) { return () => {}; }',
        'function RawBody() { return () => {}; }',
        'const bodyInput = Symbol();',
        '@Controller()',
        'class SampleController {',
        '  @Post("/webhook")',
        '  @RawBody()',
        '  handle(ctx: any) { ctx.validated(bodyInput, WebhookPayload); }',
        '}',
      ].join('\n');

      const adapterClass = createTestAdapterClass('TestAdapter', {
        decorators: {
          controller: { __zipbul_ref: 'Controller' },
          handlers: [{ __zipbul_ref: 'Post' }],
          options: [{ __zipbul_ref: 'RawBody' }],
        },
      });
      const fileMap = await buildFileMapWithCode(code, adapterClass);
      const resolver = new AdapterDefinitionResolver();

      // Act
      const result = await resolver.resolve({ fileMap, projectRoot });
      const serialized = JSON.stringify(result.handlerIndex);
      const deserialized = JSON.parse(serialized) as typeof result.handlerIndex;

      // Assert — both options and validations survive
      const entry = deserialized[0];

      expect(entry).toBeDefined();
      expect(entry!.options).toBeDefined();
      expect(entry!.options).toHaveLength(1);
      expect(entry!.options![0]!.name).toBe('RawBody');
      expect(entry!.validations).toBeDefined();
      expect(entry!.validations).toHaveLength(1);
      expect(entry!.validations![0]!.keyRef).toBe('bodyInput');
      expect(entry!.validations![0]!.metatypeKey).toBe('WebhookPayload');
    });
  });

  // =======================================================================
  // compiledPre / compiledPost — dead-step elimination & Handler split
  // =======================================================================

  describe('compiledPre / compiledPost', () => {
    /**
     * Helper: creates an adapter class with a `pipeline` property (plain string array).
     */
    const createPipelineAdapterClass = (
      pipelineSteps: string[],
      extras?: Partial<Record<string, AnalyzerValue>>,
    ): ClassMetadata => createTestAdapterClass('TestAdapter', {
      pipeline: pipelineSteps,
      ...extras,
    });

    it('should split pipeline at Handler into compiledPre and compiledPost', async () => {
      const adapterClass = createPipelineAdapterClass([
        'ResolveRoute', 'ParseBody', 'Guard', 'Validation', 'Handler', 'WriteResponse', 'Serialize',
      ]);
      const fileMap = await buildFileMapWithCode(controllerCode, adapterClass);
      const resolver = new AdapterDefinitionResolver();

      const result = await resolver.resolve({ fileMap, projectRoot });
      const entry = result.handlerIndex[0];

      expect(entry?.compiledPre).toEqual(['ResolveRoute', 'ParseBody']);
      expect(entry?.compiledPost).toEqual(['WriteResponse', 'Serialize']);
    });

    it('should not include Handler in either compiledPre or compiledPost', async () => {
      const adapterClass = createPipelineAdapterClass([
        'ResolveRoute', 'Guard', 'Validation', 'Handler', 'WriteResponse',
      ]);
      const fileMap = await buildFileMapWithCode(controllerCode, adapterClass);
      const resolver = new AdapterDefinitionResolver();

      const result = await resolver.resolve({ fileMap, projectRoot });
      const entry = result.handlerIndex[0];

      expect(entry?.compiledPre).not.toContain('Handler');
      expect(entry?.compiledPost).not.toContain('Handler');
    });

    it('should eliminate phase step when no middlewares registered for that phase', async () => {
      const adapterClass = createPipelineAdapterClass([
        'OnReceive', 'PostParse', 'Guard', 'Validation', 'Handler', 'OnComplete',
      ]);
      const fileMap = await buildFileMapWithCode(controllerCode, adapterClass);
      const resolver = new AdapterDefinitionResolver();

      const result = await resolver.resolve({ fileMap, projectRoot });
      const entry = result.handlerIndex[0];

      // No middlewares registered for any phase → all phase steps eliminated
      expect(entry?.compiledPre).toEqual([]);
      expect(entry?.compiledPost).toEqual([]);
    });

    it('should retain phase step when global middleware is registered for that phase', async () => {
      const code = [
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        'function GlobalMw() {}',
        '',
        '@Controller()',
        'class SampleController {',
        '  @Get()',
        '  handle() {}',
        '}',
      ].join('\n');

      const adapterClass = createPipelineAdapterClass([
        'OnReceive', 'Guard', 'Validation', 'Handler', 'OnComplete',
      ]);
      const fileMap = await buildFileMapWithCode(code, adapterClass);

      // Add module with global middleware for OnReceive phase
      fileMap.set('/project/app/__module__.ts', {
        filePath: '/project/app/__module__.ts',
        classes: [],
        reExports: [],
        exports: [],
        defineModuleCalls: [],
        imports: {},
        moduleDefinition: {
          name: 'AppModule',
          providers: [],
          imports: {},
          adapters: [{
            adapter: { __zipbul_ref: 'TestAdapter' },
            middlewares: { OnReceive: [{ __zipbul_ref: 'GlobalMw' }] },
          }],
        },
      });

      const resolver = new AdapterDefinitionResolver();
      const graph = {
        classMap: new Map([['SampleController', { name: 'AppModule' }]]),
        registerControllers() {},
      } as unknown;

      const result = await resolver.resolve({ fileMap, projectRoot, graph: graph as never });
      const entry = result.handlerIndex[0];

      expect(entry?.compiledPre).toContain('OnReceive');
    });

    it('should retain phase step when route-level middleware is registered for that phase', async () => {
      const code = [
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        'function UseMiddlewares() { return () => {}; }',
        'function RouteMw() {}',
        '',
        '@Controller()',
        'class SampleController {',
        '  @Get()',
        '  @UseMiddlewares("OnReceive", [RouteMw])',
        '  handle() {}',
        '}',
      ].join('\n');

      const adapterClass = createPipelineAdapterClass([
        'OnReceive', 'Guard', 'Validation', 'Handler',
      ]);
      const fileMap = await buildFileMapWithCode(code, adapterClass);
      const resolver = new AdapterDefinitionResolver();

      const result = await resolver.resolve({ fileMap, projectRoot });
      const entry = result.handlerIndex[0];

      expect(entry?.compiledPre).toContain('OnReceive');
    });

    it('should eliminate Guard step when no guards registered from any scope', async () => {
      const adapterClass = createPipelineAdapterClass([
        'OnReceive', 'Guard', 'Validation', 'Handler', 'OnComplete',
      ]);
      const fileMap = await buildFileMapWithCode(controllerCode, adapterClass);
      const resolver = new AdapterDefinitionResolver();

      const result = await resolver.resolve({ fileMap, projectRoot });
      const entry = result.handlerIndex[0];

      expect(entry?.compiledPre).not.toContain('Guard');
    });

    it('should retain Guard step when merged guards exist', async () => {
      const code = [
        'function Controller() { return () => {}; }',
        'function Get() { return () => {}; }',
        'function UseGuards() { return () => {}; }',
        'function MyGuard() {}',
        '',
        '@Controller()',
        'class SampleController {',
        '  @Get()',
        '  @UseGuards(MyGuard)',
        '  handle() {}',
        '}',
      ].join('\n');

      const adapterClass = createPipelineAdapterClass([
        'Guard', 'Validation', 'Handler',
      ]);
      const fileMap = await buildFileMapWithCode(code, adapterClass);
      const resolver = new AdapterDefinitionResolver();

      const result = await resolver.resolve({ fileMap, projectRoot });
      const entry = result.handlerIndex[0];

      expect(entry?.compiledPre).toContain('Guard');
    });

    it('should eliminate Validation step when handler has no validations', async () => {
      const adapterClass = createPipelineAdapterClass([
        'Guard', 'Validation', 'Handler',
      ]);
      const fileMap = await buildFileMapWithCode(controllerCode, adapterClass);
      const resolver = new AdapterDefinitionResolver();

      const result = await resolver.resolve({ fileMap, projectRoot });
      const entry = result.handlerIndex[0];

      expect(entry?.compiledPre).not.toContain('Validation');
    });

    // REMOVED: 'should retain Validation step when handler has validations'
    // ctx.validated() API deleted. New DX: ctx.request.getBody(Dto).

    it('should always retain adapter-specific steps (not phase, not core)', async () => {
      const adapterClass = createPipelineAdapterClass([
        'OnReceive', 'ResolveRoute', 'ParseBody', 'Guard', 'Validation', 'Handler', 'WriteResponse', 'Serialize',
      ]);
      const fileMap = await buildFileMapWithCode(controllerCode, adapterClass);
      const resolver = new AdapterDefinitionResolver();

      const result = await resolver.resolve({ fileMap, projectRoot });
      const entry = result.handlerIndex[0];

      // Adapter steps always retained, phases eliminated (no MW)
      expect(entry?.compiledPre).toEqual(['ResolveRoute', 'ParseBody']);
      expect(entry?.compiledPost).toEqual(['WriteResponse', 'Serialize']);
    });

    it('should eliminate post-handler phase step when no middlewares registered', async () => {
      const adapterClass = createPipelineAdapterClass([
        'ResolveRoute', 'Guard', 'Validation', 'Handler', 'OnComplete', 'WriteResponse',
      ]);
      const fileMap = await buildFileMapWithCode(controllerCode, adapterClass);
      const resolver = new AdapterDefinitionResolver();

      const result = await resolver.resolve({ fileMap, projectRoot });
      const entry = result.handlerIndex[0];

      // OnComplete is a phase with no MW → eliminated from post
      // WriteResponse is adapter step → retained
      expect(entry?.compiledPost).toEqual(['WriteResponse']);
    });

    it('should produce no compiledPre/compiledPost when adapter has no pipeline property', async () => {
      const fileMap = await buildStandardFileMap();
      const resolver = new AdapterDefinitionResolver();

      const result = await resolver.resolve({ fileMap, projectRoot });
      const entry = result.handlerIndex[0];

      expect(entry?.compiledPre).toBeUndefined();
      expect(entry?.compiledPost).toBeUndefined();
    });

    it('should return an error when pipeline is missing CoreStep.Handler', async () => {
      const adapterClass = createPipelineAdapterClass(['Guard', 'Validation']);
      const fileMap = await buildFileMapWithCode(controllerCode, adapterClass);
      const resolver = new AdapterDefinitionResolver();

      const result = await resolver.resolve({ fileMap, projectRoot });

      expect(isErr(result)).toBe(true);
    });

    it('should return an error when pipeline is missing CoreStep.Guard', async () => {
      const adapterClass = createPipelineAdapterClass(['Validation', 'Handler']);
      const fileMap = await buildFileMapWithCode(controllerCode, adapterClass);
      const resolver = new AdapterDefinitionResolver();

      const result = await resolver.resolve({ fileMap, projectRoot });

      expect(isErr(result)).toBe(true);
    });

    it('should return an error when pipeline is missing CoreStep.Validation', async () => {
      const adapterClass = createPipelineAdapterClass(['Guard', 'Handler']);
      const fileMap = await buildFileMapWithCode(controllerCode, adapterClass);
      const resolver = new AdapterDefinitionResolver();

      const result = await resolver.resolve({ fileMap, projectRoot });

      expect(isErr(result)).toBe(true);
    });
  });

  // =======================================================================
  // Interning — identical compiled outputs share references
  // =======================================================================

  describe('interning', () => {
    it('should share the same compiledPre reference for handlers with identical pre steps', async () => {
      const code = [
        'function Controller() { return () => {}; }',
        'function Get(path: string) { return () => {}; }',
        '',
        '@Controller()',
        'class SampleController {',
        '  @Get("/a")',
        '  handleA() {}',
        '  @Get("/b")',
        '  handleB() {}',
        '}',
      ].join('\n');

      const adapterClass = createTestAdapterClass('TestAdapter', {
        pipeline: ['ResolveRoute', 'ParseBody', 'Guard', 'Validation', 'Handler', 'WriteResponse'],
      });
      const fileMap = await buildFileMapWithCode(code, adapterClass);
      const resolver = new AdapterDefinitionResolver();

      const result = await resolver.resolve({ fileMap, projectRoot });

      expect(result.handlerIndex.length).toBe(2);
      const entryA = result.handlerIndex[0]!;
      const entryB = result.handlerIndex[1]!;

      // Same content
      expect(entryA.compiledPre).toEqual(entryB.compiledPre);
      expect(entryA.compiledPost).toEqual(entryB.compiledPost);

      // Same reference (interned)
      expect(entryA.compiledPre).toBe(entryB.compiledPre);
      expect(entryA.compiledPost).toBe(entryB.compiledPost);
    });

    it('should share the same mergedGuardKeys reference for handlers with identical global guards', async () => {
      const code = [
        'function Controller() { return () => {}; }',
        'function Get(path: string) { return () => {}; }',
        'function MyGuard() {}',
        '',
        '@Controller()',
        'class SampleController {',
        '  @Get("/a")',
        '  handleA() {}',
        '  @Get("/b")',
        '  handleB() {}',
        '}',
      ].join('\n');

      const adapterClass = createTestAdapterClass('TestAdapter', {
        pipeline: ['Guard', 'Validation', 'Handler'],
      });
      const fileMap = await buildFileMapWithCode(code, adapterClass);

      // Global guard via module config
      fileMap.set('/project/app/__module__.ts', {
        filePath: '/project/app/__module__.ts',
        classes: [],
        reExports: [],
        exports: [],
        defineModuleCalls: [],
        imports: {},
        moduleDefinition: {
          name: 'AppModule',
          providers: [],
          imports: {},
          adapters: [{
            adapter: { __zipbul_ref: 'TestAdapter' },
            guards: [{ __zipbul_ref: 'MyGuard' }],
          }],
        },
      });

      const resolver = new AdapterDefinitionResolver();
      const graph = {
        classMap: new Map([['SampleController', { name: 'AppModule' }]]),
        registerControllers() {},
      } as unknown;

      const result = await resolver.resolve({ fileMap, projectRoot, graph: graph as never });

      expect(result.handlerIndex.length).toBe(2);

      // Same global guard → same merged keys → interned (same reference)
      expect(result.handlerIndex[0]!.mergedGuardKeys).toBe(result.handlerIndex[1]!.mergedGuardKeys);
    });

    it('should not share references when compiled outputs differ', async () => {
      const code = [
        'function Controller() { return () => {}; }',
        'function Get(path: string) { return () => {}; }',
        'function UseGuards() { return () => {}; }',
        'function GuardA() {}',
        'function GuardB() {}',
        '',
        '@Controller()',
        'class SampleController {',
        '  @Get("/a")',
        '  @UseGuards(GuardA)',
        '  handleA() {}',
        '  @Get("/b")',
        '  @UseGuards(GuardB)',
        '  handleB() {}',
        '}',
      ].join('\n');

      const adapterClass = createTestAdapterClass('TestAdapter', {
        pipeline: ['Guard', 'Validation', 'Handler'],
      });
      const fileMap = await buildFileMapWithCode(code, adapterClass);
      const resolver = new AdapterDefinitionResolver();

      const result = await resolver.resolve({ fileMap, projectRoot });

      expect(result.handlerIndex.length).toBe(2);

      // Different guards → different references
      expect(result.handlerIndex[0]!.mergedGuardKeys).not.toBe(result.handlerIndex[1]!.mergedGuardKeys);
    });

    it('should share the same validations reference for handlers with identical validations', async () => {
      const code = [
        'function Controller() { return () => {}; }',
        'function Get(path: string) { return () => {}; }',
        'const bodyInput = Symbol();',
        '',
        '@Controller()',
        'class SampleController {',
        '  @Get("/a")',
        '  handleA(ctx: any) { ctx.validated(bodyInput, UserDto); }',
        '  @Get("/b")',
        '  handleB(ctx: any) { ctx.validated(bodyInput, UserDto); }',
        '}',
      ].join('\n');

      const adapterClass = createTestAdapterClass('TestAdapter', {
        pipeline: ['Guard', 'Validation', 'Handler'],
      });
      const fileMap = await buildFileMapWithCode(code, adapterClass);
      const resolver = new AdapterDefinitionResolver();

      const result = await resolver.resolve({ fileMap, projectRoot });

      expect(result.handlerIndex.length).toBe(2);
      expect(result.handlerIndex[0]!.validations).toBe(result.handlerIndex[1]!.validations);
    });

    it('should share the same options reference for handlers with identical options', async () => {
      const code = [
        'function Controller() { return () => {}; }',
        'function Get(path: string) { return () => {}; }',
        'function RawBody() { return () => {}; }',
        '',
        '@Controller()',
        'class SampleController {',
        '  @Get("/a")',
        '  @RawBody()',
        '  handleA() {}',
        '  @Get("/b")',
        '  @RawBody()',
        '  handleB() {}',
        '}',
      ].join('\n');

      const adapterClass = createTestAdapterClass('TestAdapter', {
        pipeline: ['Guard', 'Validation', 'Handler'],
        decorators: {
          controller: { __zipbul_ref: 'Controller' },
          handlers: [{ __zipbul_ref: 'Get' }],
          options: [{ __zipbul_ref: 'RawBody' }],
        },
      });
      const fileMap = await buildFileMapWithCode(code, adapterClass);
      const resolver = new AdapterDefinitionResolver();

      const result = await resolver.resolve({ fileMap, projectRoot });

      expect(result.handlerIndex.length).toBe(2);
      expect(result.handlerIndex[0]!.options).toBe(result.handlerIndex[1]!.options);
    });

    it('should share mergedPhaseMiddlewareKeys reference for handlers with identical phase MW', async () => {
      const code = [
        'function Controller() { return () => {}; }',
        'function Get(path: string) { return () => {}; }',
        'function GlobalMw() {}',
        '',
        '@Controller()',
        'class SampleController {',
        '  @Get("/a")',
        '  handleA() {}',
        '  @Get("/b")',
        '  handleB() {}',
        '}',
      ].join('\n');

      const adapterClass = createTestAdapterClass('TestAdapter', {
        pipeline: ['OnReceive', 'Guard', 'Validation', 'Handler'],
      });
      const fileMap = await buildFileMapWithCode(code, adapterClass);

      fileMap.set('/project/app/__module__.ts', {
        filePath: '/project/app/__module__.ts',
        classes: [],
        reExports: [],
        exports: [],
        defineModuleCalls: [],
        imports: {},
        moduleDefinition: {
          name: 'AppModule',
          providers: [],
          imports: {},
          adapters: [{
            adapter: { __zipbul_ref: 'TestAdapter' },
            middlewares: { OnReceive: [{ __zipbul_ref: 'GlobalMw' }] },
          }],
        },
      });

      const resolver = new AdapterDefinitionResolver();
      const graph = {
        classMap: new Map([['SampleController', { name: 'AppModule' }]]),
        registerControllers() {},
      } as unknown;

      const result = await resolver.resolve({ fileMap, projectRoot, graph: graph as never });

      expect(result.handlerIndex.length).toBe(2);

      // Same reference (interned)
      expect(result.handlerIndex[0]!.mergedPhaseMiddlewareKeys).toBe(
        result.handlerIndex[1]!.mergedPhaseMiddlewareKeys,
      );
    });
  });

});
