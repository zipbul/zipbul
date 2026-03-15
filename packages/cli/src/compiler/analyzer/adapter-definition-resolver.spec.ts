import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { join } from 'path';

import { isErr } from '@zipbul/result';
import type { FileAnalysis } from './graph/interfaces';
import type { FileSetup } from '../../../test/shared/interfaces';
import type { AstParseResult } from './test/types';
import type { AnalyzerValue, AnalyzerValueRecord } from './types';
import type { ClassMetadata, PropertyMetadata } from './interfaces';

import { createBunFileStub } from '../../../test/shared/stubs';
import { PathResolver } from '../../common';
import { AstParser } from './ast-parser';
import { AdapterDefinitionResolver } from './adapter-definition-resolver';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseOrFail(parser: AstParser, filename: string, code: string): AstParseResult {
  const result = parser.parse(filename, code);

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

  const buildStandardFileMap = (
    adapterClass: ClassMetadata = createTestAdapterClass(),
  ): Map<string, FileAnalysis> => {
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();

    // Controller file
    const controllerParse = parseOrFail(parser, controllerFile, controllerCode);
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
    const entryParse = parseOrFail(parser, entryFile, 'export const adapterDefinition = defineAdapter(TestAdapter);');
    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: [adapterClass],
      reExports: entryParse.reExports,
      exports: entryParse.exports,
      exportedValues: { adapterDefinition: wrapDefineAdapter({ __zipbul_ref: adapterClass.className }) },
    };

    applyParseToAnalysis(entryAnalysis, entryParse);
    fileMap.set(entryFile, entryAnalysis);

    return fileMap;
  };

  // =======================================================================
  // Happy Path (HP)
  // =======================================================================

  it('should resolve adapter with class reference containing all required property initializers', async () => {
    // Arrange
    const fileMap = buildStandardFileMap();
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
    const controllerParse = parseOrFail(parser, controllerFile, controllerCode);
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
    const controllerParseB = parseOrFail(parser, controllerFileB, controllerCodeB);
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
    const entryParseA = parseOrFail(parser, entryA, 'export const adapterDefinition = defineAdapter(AdapterA);');
    const entryAnalysisA: FileAnalysis = {
      filePath: entryA,
      classes: [adapterAClass],
      reExports: entryParseA.reExports,
      exports: entryParseA.exports,
      exportedValues: { adapterDefinition: wrapDefineAdapter({ __zipbul_ref: 'AdapterA' }) },
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
    const entryParseB = parseOrFail(parser, entryB, 'export const adapterDefinition = defineAdapter(AdapterB);');
    const entryAnalysisB: FileAnalysis = {
      filePath: entryB,
      classes: [adapterBClass],
      reExports: entryParseB.reExports,
      exports: entryParseB.exports,
      exportedValues: { adapterDefinition: wrapDefineAdapter({ __zipbul_ref: 'AdapterB' }) },
    };

    applyParseToAnalysis(entryAnalysisB, entryParseB);
    fileMap.set(entryB, entryAnalysisB);

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
    const controllerParse = parseOrFail(parser, controllerFile, controllerCode);
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
      exportedValues: { adapterDefinition: wrapDefineAdapter({ __zipbul_ref: 'TestAdapter' }) },
    };

    fileMap.set(specFile, specAnalysis);

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

    const controllerParse = parseOrFail(parser, controllerFile, controllerCode);
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
      exportedValues: { adapterDefinition: wrapDefineAdapter({ __zipbul_ref: 'TestAdapter' }) },
    };

    fileMap.set(specFile, specAnalysis);

    const resolver = new AdapterDefinitionResolver();

    // Act
    const result = await resolver.resolve({ fileMap, projectRoot });

    // Assert
    expect(Object.keys(result.adapterStaticSchemas)).toEqual(['TestAdapter']);
  });

  it('should build handlerIndex with correct id format', async () => {
    // Arrange
    const fileMap = buildStandardFileMap();
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

    const moduleParse = parseOrFail(parser, moduleFile, moduleCode);
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
    const controllerParse = parseOrFail(parser, controllerFile, controllerCode);
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
    const entryParse = parseOrFail(parser, entryFile, 'export const adapterDefinition = defineAdapter(TestAdapter);');
    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: [adapterClass],
      reExports: entryParse.reExports,
      exports: entryParse.exports,
      exportedValues: { adapterDefinition: wrapDefineAdapter({ __zipbul_ref: 'TestAdapter' }) },
    };

    applyParseToAnalysis(entryAnalysis, entryParse);
    fileMap.set(entryFile, entryAnalysis);

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

    const controllerParse = parseOrFail(parser, controllerFile, code);
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
    const entryParse = parseOrFail(parser, entryFile, 'export const adapterDefinition = defineAdapter(TestAdapter);');
    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: [adapterClass],
      reExports: entryParse.reExports,
      exports: entryParse.exports,
      exportedValues: { adapterDefinition: wrapDefineAdapter({ __zipbul_ref: 'TestAdapter' }) },
    };

    applyParseToAnalysis(entryAnalysis, entryParse);
    fileMap.set(entryFile, entryAnalysis);

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

    const controllerParse = parseOrFail(parser, controllerFile, code);
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
    const entryParse = parseOrFail(parser, entryFile, 'export const adapterDefinition = defineAdapter(TestAdapter);');
    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: [adapterClass],
      reExports: entryParse.reExports,
      exports: entryParse.exports,
      exportedValues: { adapterDefinition: wrapDefineAdapter({ __zipbul_ref: 'TestAdapter' }) },
    };

    applyParseToAnalysis(entryAnalysis, entryParse);
    fileMap.set(entryFile, entryAnalysis);

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

    const controllerParse = parseOrFail(parser, controllerFile, controllerCode);
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

    const controllerParse = parseOrFail(parser, controllerFile, controllerCode);
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

  it('should throw when defineAdapter argument is not a class reference', async () => {
    // Arrange
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();

    const controllerParse = parseOrFail(parser, controllerFile, controllerCode);
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
      exportedValues: { adapterDefinition: wrapDefineAdapter('not-a-class-ref') },
    };

    fileMap.set(entryFile, entryAnalysis);

    const resolver = new AdapterDefinitionResolver();

    // Act & Assert
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/class reference/);
    }
  });

  it('should throw when referenced class cannot be found', async () => {
    // Arrange
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();

    const controllerParse = parseOrFail(parser, controllerFile, controllerCode);
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
      exportedValues: { adapterDefinition: wrapDefineAdapter({ __zipbul_ref: 'NonExistentClass' }) },
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
    const fileMap = buildStandardFileMap(createTestAdapterClass('MyCustomAdapter'));
    const resolver = new AdapterDefinitionResolver();

    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(Object.keys(result.adapterStaticSchemas)).toEqual(['MyCustomAdapter']);
  });

  it('should throw when decorators.controller is not an identifier', async () => {
    // Arrange
    const fileMap = buildStandardFileMap(
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
    const fileMap1 = buildStandardFileMap(
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
    const fileMap2 = buildStandardFileMap(
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
    const controllerParse = parseOrFail(parser, controllerFile, 'class Empty {}');
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

    const controllerParse = parseOrFail(parser, controllerFile, controllerCode);
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
      const parse = parseOrFail(parser, ep, 'export const adapterDefinition = defineAdapter(TestAdapter);');
      const analysis: FileAnalysis = {
        filePath: ep,
        classes: [adapterClass],
        reExports: parse.reExports,
        exports: parse.exports,
        exportedValues: { adapterDefinition: wrapDefineAdapter({ __zipbul_ref: adapterClass.className }) },
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

    const controllerParse = parseOrFail(parser, controllerFile, code);
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
      const parse = parseOrFail(parser, ep as string, 'export const adapterDefinition = defineAdapter(Adapter);');
      const analysis: FileAnalysis = {
        filePath: ep as string,
        classes: [cls],
        reExports: parse.reExports,
        exports: parse.exports,
        exportedValues: { adapterDefinition: wrapDefineAdapter({ __zipbul_ref: cls.className }) },
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

    const controllerParse = parseOrFail(parser, controllerFile, code);
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
    const entryParse = parseOrFail(parser, entryFile, 'export const adapterDefinition = defineAdapter(TestAdapter);');
    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: [adapterClass],
      reExports: entryParse.reExports,
      exports: entryParse.exports,
      exportedValues: { adapterDefinition: wrapDefineAdapter({ __zipbul_ref: 'TestAdapter' }) },
    };

    applyParseToAnalysis(entryAnalysis, entryParse);
    fileMap.set(entryFile, entryAnalysis);

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
      exportedValues: { adapterDefinition: wrapDefineAdapter({ __zipbul_ref: 'TestAdapter' }) },
    };

    fileMap.set(entryFile, entryAnalysis);

    const resolver = new AdapterDefinitionResolver();

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

    const controllerParse = parseOrFail(parser, controllerFile, code);
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
    const entryParse = parseOrFail(parser, entryFile, 'export const adapterDefinition = defineAdapter(TestAdapter);');
    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: [adapterClass],
      reExports: entryParse.reExports,
      exports: entryParse.exports,
      exportedValues: { adapterDefinition: wrapDefineAdapter({ __zipbul_ref: 'TestAdapter' }) },
    };

    applyParseToAnalysis(entryAnalysis, entryParse);
    fileMap.set(entryFile, entryAnalysis);

    const resolver = new AdapterDefinitionResolver();

    // Act & Assert
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/Unsupported middleware hook/);
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
    const noClassParse = parseOrFail(parser, controllerFile, noClassCode);
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
    const entryParse = parseOrFail(parser, entryFile, 'export const adapterDefinition = defineAdapter(TestAdapter);');
    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: [adapterClass],
      reExports: entryParse.reExports,
      exports: entryParse.exports,
      exportedValues: { adapterDefinition: wrapDefineAdapter({ __zipbul_ref: 'TestAdapter' }) },
    };

    applyParseToAnalysis(entryAnalysis, entryParse);
    fileMap.set(entryFile, entryAnalysis);

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

    const controllerParse = parseOrFail(parser, controllerFile, controllerCode);
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

    const controllerParse = parseOrFail(parser, controllerFile, controllerCode);
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

    const controllerParse = parseOrFail(parser, controllerFile, controllerCode);
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

    const controllerParse = parseOrFail(parser, controllerFile, controllerCode);
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
      const parse = parseOrFail(parser, ep as string, 'export const adapterDefinition = defineAdapter(Adapter);');
      const analysis: FileAnalysis = {
        filePath: ep as string,
        classes: [cls],
        reExports: parse.reExports,
        exports: parse.exports,
        exportedValues: { adapterDefinition: wrapDefineAdapter({ __zipbul_ref: cls.className }) },
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
    const controllerParse = parseOrFail(parser, controllerFile, controllerCode);
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
    const controllerParseB = parseOrFail(parser, controllerFileB, controllerCodeB);
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
      const parse = parseOrFail(parser, ep as string, 'export const adapterDefinition = defineAdapter(Adapter);');
      const analysis: FileAnalysis = {
        filePath: ep as string,
        classes: [cls],
        reExports: parse.reExports,
        exports: parse.exports,
        exportedValues: { adapterDefinition: wrapDefineAdapter({ __zipbul_ref: cls.className }) },
      };

      applyParseToAnalysis(analysis, parse);
      fileMap.set(ep as string, analysis);
    }

    const resolver = new AdapterDefinitionResolver();

    // Act
    const result = await resolver.resolve({ fileMap, projectRoot });

    // Assert — alphabetical order
    expect(Object.keys(result.adapterStaticSchemas)).toEqual(['AlphaAdapter', 'BravoAdapter']);
  });

  it('should sort handler index alphabetically', async () => {
    // Arrange — two controllers for the same adapter, different file paths
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();

    const controllerFileZ = join(srcDir, 'z-controller.ts');
    const controllerFileA = join(srcDir, 'a-controller.ts');

    for (const file of [controllerFileZ, controllerFileA]) {
      const controllerParse = parseOrFail(parser, file, controllerCode);
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
    const entryParse = parseOrFail(parser, entryFile, 'export const adapterDefinition = defineAdapter(TestAdapter);');
    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: [adapterClass],
      reExports: entryParse.reExports,
      exports: entryParse.exports,
      exportedValues: { adapterDefinition: wrapDefineAdapter({ __zipbul_ref: 'TestAdapter' }) },
    };

    applyParseToAnalysis(entryAnalysis, entryParse);
    fileMap.set(entryFile, entryAnalysis);

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

  const buildFileMapWithCode = (
    controllerSource: string,
    adapterClass: ClassMetadata = createTestAdapterClass(),
  ): Map<string, FileAnalysis> => {
    const parser = new AstParser();
    const fileMap = new Map<string, FileAnalysis>();

    const controllerParse = parseOrFail(parser, controllerFile, controllerSource);
    const controllerAnalysis: FileAnalysis = {
      filePath: controllerFile,
      classes: controllerParse.classes,
      reExports: controllerParse.reExports,
      exports: controllerParse.exports,
      importEntries: [{ source: '@test/adapter', resolvedSource: entryFile, isRelative: false }],
    };

    applyParseToAnalysis(controllerAnalysis, controllerParse);
    fileMap.set(controllerFile, controllerAnalysis);

    const entryParse = parseOrFail(parser, entryFile, 'export const adapterDefinition = defineAdapter(TestAdapter);');
    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: [adapterClass],
      reExports: entryParse.reExports,
      exports: entryParse.exports,
      exportedValues: { adapterDefinition: wrapDefineAdapter({ __zipbul_ref: adapterClass.className }) },
    };

    applyParseToAnalysis(entryAnalysis, entryParse);
    fileMap.set(entryFile, entryAnalysis);

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

    const ctrlParse = parseOrFail(parser, controllerFile, code);
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
    const testParse = parseOrFail(parser, entryFile, 'export const adapterDefinition = defineAdapter(TestAdapter);');
    const testEntry: FileAnalysis = {
      filePath: entryFile,
      classes: [testClass],
      reExports: testParse.reExports,
      exports: testParse.exports,
      exportedValues: { adapterDefinition: wrapDefineAdapter({ __zipbul_ref: 'TestAdapter' }) },
    };

    applyParseToAnalysis(testEntry, testParse);
    fileMap.set(entryFile, testEntry);

    // Adapter 'other' (same controller decorator name 'Controller')
    const otherClass = createTestAdapterClass('OtherAdapter');
    const otherParse = parseOrFail(parser, otherEntryFile, 'export const adapterDefinition = defineAdapter(OtherAdapter);');
    const otherEntry: FileAnalysis = {
      filePath: otherEntryFile,
      classes: [otherClass],
      reExports: otherParse.reExports,
      exports: otherParse.exports,
      exportedValues: { adapterDefinition: wrapDefineAdapter({ __zipbul_ref: 'OtherAdapter' }) },
    };

    applyParseToAnalysis(otherEntry, otherParse);
    fileMap.set(otherEntryFile, otherEntry);

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

    const fileMap = buildFileMapWithCode(code);
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

    const fileMap = buildFileMapWithCode(code);
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

    const fileMap = buildFileMapWithCode(code);
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

    const fileMap = buildFileMapWithCode(code);
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

    const fileMap = buildFileMapWithCode(code);
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

    const fileMap = buildFileMapWithCode(code);
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

    const fileMap = buildFileMapWithCode(code);
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
    const controllerParse = parseOrFail(parser, controllerFile, controllerCode);
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
    const entryParse = parseOrFail(parser, entryFile, 'export const adapterSpec = defineAdapter(TestAdapter);');
    const entryAnalysis: FileAnalysis = {
      filePath: entryFile,
      classes: [adapterClass],
      reExports: entryParse.reExports,
      exports: entryParse.exports,
      exportedValues: { adapterSpec: wrapDefineAdapter({ __zipbul_ref: adapterClass.className }) },
    };

    applyParseToAnalysis(entryAnalysis, entryParse);
    fileMap.set(entryFile, entryAnalysis);

    const resolver = new AdapterDefinitionResolver();
    const result = await resolver.resolve({ fileMap, projectRoot });

    expect(isErr(result)).toBe(false);
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
    const resolver = new AdapterDefinitionResolver();

    // isStatic check should fire first, not isPrivateName
    const result = await resolver.resolve({ fileMap, projectRoot });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.data.why).toMatch(/static/i);
    }
  });
});
