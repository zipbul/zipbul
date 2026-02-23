import { describe, expect, it } from 'bun:test';

// MUST: MUST-8 (manifest sorting deterministic)

import { runInNewContext } from 'node:vm';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';

import type { FileAnalysis } from '../analyzer/graph/interfaces';
import type { ClassMetadata } from '../analyzer/interfaces';
import type { AnalyzerValue, AnalyzerValueRecord } from '../analyzer/types';
import type { DeepFreezeModule, GeneratedBlockParams, MetadataRegistryModule, ScopedKeysMapModule } from './types';

import { ModuleGraph } from '../analyzer/graph/module-graph';

import { ManifestGenerator } from './manifest-generator';

const isAnalyzerValueRecord = (value: AnalyzerValue): value is AnalyzerValueRecord => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const isAnalyzerValueArray = (value: AnalyzerValue): value is AnalyzerValue[] => {
  return Array.isArray(value);
};

const assertRecordValue = (value: AnalyzerValue): AnalyzerValueRecord => {
  if (isAnalyzerValueRecord(value)) {
    return value;
  }

  throw new Error('Expected a record value.');
};

const assertArrayValue = (value: AnalyzerValue): AnalyzerValue[] => {
  if (isAnalyzerValueArray(value)) {
    return value;
  }

  throw new Error('Expected an array value.');
};

function executeModule<TModule>(jsCode: string, initialExports: TModule): TModule {
  const moduleContainer = { exports: initialExports };
  const context = { module: moduleContainer, exports: moduleContainer.exports };

  runInNewContext(jsCode, context);

  return moduleContainer.exports;
}

function createSingleModuleGraph(): ModuleGraph {
  const modulePath = '/app/src/app/__module__.ts';
  const fileMap = new Map<string, FileAnalysis>();

  fileMap.set(modulePath, {
    filePath: modulePath,
    classes: [],
    reExports: [],
    exports: [],
    defineModuleCalls: [
      {
        callee: 'defineModule',
        importSource: '@zipbul/core',
        args: [],
        exportedName: 'appModule',
      },
    ],
    imports: {},
    moduleDefinition: {
      name: 'AppModule',
      providers: [],
      imports: {},
    },
  });

  const graph = new ModuleGraph(fileMap, '__module__.ts');

  graph.build();

  return graph;
}

function createInjectableClassMetadata(className: string): ClassMetadata {
  return {
    className,
    heritage: undefined,
    decorators: [
      {
        name: 'Injectable',
        arguments: [{ visibleTo: 'all', scope: 'singleton' }],
      },
    ],
    constructorParams: [],
    methods: [],
    properties: [],
    imports: {},
  };
}

function createMultiModuleGraph(): ModuleGraph {
  const moduleAPath = '/app/src/a/__module__.ts';
  const moduleBPath = '/app/src/b/__module__.ts';
  const classAPath = '/app/src/a/a.service.ts';
  const classBPath = '/app/src/b/b.service.ts';
  const fileMap = new Map<string, FileAnalysis>();

  fileMap.set(moduleAPath, {
    filePath: moduleAPath,
    classes: [],
    reExports: [],
    exports: [],
    defineModuleCalls: [
      {
        callee: 'defineModule',
        importSource: '@zipbul/core',
        args: [],
        exportedName: 'appModule',
      },
    ],
    imports: {},
    moduleDefinition: {
      name: 'AModule',
      providers: [],
      imports: {},
    },
  });
  fileMap.set(moduleBPath, {
    filePath: moduleBPath,
    classes: [],
    reExports: [],
    exports: [],
    defineModuleCalls: [
      {
        callee: 'defineModule',
        importSource: '@zipbul/core',
        args: [],
        exportedName: 'bModule',
      },
    ],
    imports: {},
    moduleDefinition: {
      name: 'BModule',
      providers: [],
      imports: {},
    },
  });
  fileMap.set(classAPath, {
    filePath: classAPath,
    classes: [createInjectableClassMetadata('AService')],
    reExports: [],
    exports: [],
    imports: {},
  });
  fileMap.set(classBPath, {
    filePath: classBPath,
    classes: [createInjectableClassMetadata('BService')],
    reExports: [],
    exports: [],
    imports: {},
  });

  const graph = new ModuleGraph(fileMap, '__module__.ts');

  graph.build();

  return graph;
}

function extractGeneratedBlock(params: GeneratedBlockParams): string {
  const { code, matcher, name } = params;
  const match = code.match(matcher);

  if (!match) {
    throw new Error(`Failed to extract ${name}`);
  }

  return match[0];
}

function transpileTsModule(tsSnippet: string): string {
  return transpileModule(tsSnippet, {
    compilerOptions: {
      module: ModuleKind.CommonJS,
      target: ScriptTarget.ES2020,
    },
  }).outputText;
}

describe('ManifestGenerator', () => {
  it('should export a sealed metadata registry when generator runs', () => {
    // Arrange
    const graph = createSingleModuleGraph();
    const gen = new ManifestGenerator();
    const code = gen.generate(graph, [], '/out');
    const deepFreezeBlock = extractGeneratedBlock({
      code,
      matcher: /const deepFreeze = \([\s\S]*?\n};/,
      name: 'deepFreeze block',
    });
    const sealMapBlock = extractGeneratedBlock({
      code,
      matcher: /const sealMap = <K, V>\([\s\S]*?\n};/,
      name: 'sealMap block',
    });
    const createMetadataRegistryBlock = extractGeneratedBlock({
      code,
      matcher: /export function createMetadataRegistry\(\)\s*\{[\s\S]*?\n\}/,
      name: 'createMetadataRegistry block',
    });
    const tsSnippet = `${deepFreezeBlock}\n${sealMapBlock}\n${createMetadataRegistryBlock}\nexport const metadataRegistry = createMetadataRegistry();`;
    // Act
    const jsSnippet = transpileTsModule(tsSnippet);
    const mod = executeModule<MetadataRegistryModule>(jsSnippet, { metadataRegistry: new Map() });
    const registry = mod.metadataRegistry;

    // Assert
    expect(Object.isFrozen(registry)).toBe(true);
    expect(() => registry.set('k', 'v')).toThrow(/immutable/i);
    expect(() => registry.delete('k')).toThrow(/immutable/i);
    expect(() => {
      registry.clear();
    }).toThrow(/immutable/i);
  });

  it('should export a scoped keys map when generator runs', () => {
    // Arrange
    const graph = createSingleModuleGraph();
    const gen = new ManifestGenerator();
    const code = gen.generate(graph, [], '/out');
    const deepFreezeBlock = extractGeneratedBlock({
      code,
      matcher: /const deepFreeze = \([\s\S]*?\n};/,
      name: 'deepFreeze block',
    });
    const sealMapBlock = extractGeneratedBlock({
      code,
      matcher: /const sealMap = <K, V>\([\s\S]*?\n};/,
      name: 'sealMap block',
    });
    const createScopedKeysMapBlock = extractGeneratedBlock({
      code,
      matcher: /export function createScopedKeysMap\(\)\s*\{[\s\S]*?\n\}/,
      name: 'createScopedKeysMap block',
    });
    const tsSnippet = `${deepFreezeBlock}\n${sealMapBlock}\n${createScopedKeysMapBlock}\nexport const scopedKeysMap = createScopedKeysMap();`;
    // Act
    const jsSnippet = transpileTsModule(tsSnippet);
    const mod = executeModule<ScopedKeysMapModule>(jsSnippet, { scopedKeysMap: new Map() });
    const map = mod.scopedKeysMap;

    // Assert
    expect(Object.isFrozen(map)).toBe(true);
    expect(() => map.set('k', 'v')).toThrow(/immutable/i);
    expect(() => map.delete('k')).toThrow(/immutable/i);
    expect(() => {
      map.clear();
    }).toThrow(/immutable/i);
  });

  it('should deep-freeze nested metadata-like objects when invoked', () => {
    // Arrange
    const graph = createSingleModuleGraph();
    const gen = new ManifestGenerator();
    const code = gen.generate(graph, [], '/out');
    const deepFreezeBlock = extractGeneratedBlock({
      code,
      matcher: /const deepFreeze = \([\s\S]*?\n};/,
      name: 'deepFreeze block',
    });
    const tsSnippet = `${deepFreezeBlock}\nexport { deepFreeze };`;
    const sample: AnalyzerValueRecord = {
      className: 'A',
      decorators: [{ name: 'X', arguments: [] }],
      constructorParams: [],
      methods: [],
      properties: [],
    };
    // Act
    const jsSnippet = transpileTsModule(tsSnippet);
    const mod = executeModule<DeepFreezeModule>(jsSnippet, {
      deepFreeze: (obj: AnalyzerValue) => obj,
    });
    const deepFreeze = mod.deepFreeze;
    const decorators = assertArrayValue(sample.decorators);

    deepFreeze(sample);
    // Assert
    expect(Object.isFrozen(sample)).toBe(true);
    expect(Object.isFrozen(sample.decorators)).toBe(true);
    expect(() => {
      decorators.push({ name: 'Y', arguments: [] });
    }).toThrow();
  });

  it('should include adapterStaticSpecs and handlerIndex in JSON output when generated', () => {
    // Arrange
    const graph = createSingleModuleGraph();
    const gen = new ManifestGenerator();
    const json = gen.generateJson({
      graph,
      projectRoot: '/app',
      source: { path: '/app/zipbul.json', format: 'json' },
      resolvedConfig: {
        module: { fileName: '__module__.ts' },
        sourceDir: 'src',
        entry: 'src/main.ts',
        mcp: { exclude: [] },
      },
      adapterStaticSpecs: {
        test: {
          pipeline: ['Before', 'Guards', 'Pipes', 'Handler'],
          middlewarePhaseOrder: ['Before'],
          supportedMiddlewarePhases: { Before: true },
          entryDecorators: { controller: 'Controller', handler: ['Get'] },
        },
      },
      handlerIndex: [{ id: 'test:src/controllers.ts#SampleController.handle' }],
    });
    // Act
    const parsed = JSON.parse(json);
    const parsedRecord = assertRecordValue(parsed);
    const adapterSpecs = assertRecordValue(parsedRecord.adapterStaticSpecs);
    const handlerIndex = assertArrayValue(parsedRecord.handlerIndex);

    // Assert
    expect(adapterSpecs.test).toBeDefined();
    expect(handlerIndex).toEqual([{ id: 'test:src/controllers.ts#SampleController.handle' }]);
  });

  it('should sort modules, diGraph nodes, and handlerIndex deterministically', () => {
    const graph = createMultiModuleGraph();
    const gen = new ManifestGenerator();
    const json = gen.generateJson({
      graph,
      projectRoot: '/app',
      source: { path: '/app/zipbul.json', format: 'json' },
      resolvedConfig: {
        module: { fileName: '__module__.ts' },
        sourceDir: 'src',
        entry: 'src/main.ts',
        mcp: { exclude: [] },
      },
      adapterStaticSpecs: {
        b: {
          pipeline: ['Guards', 'Pipes', 'Handler'],
          middlewarePhaseOrder: [],
          supportedMiddlewarePhases: {},
          entryDecorators: { controller: 'Controller', handler: ['Get'] },
        },
        a: {
          pipeline: ['Guards', 'Pipes', 'Handler'],
          middlewarePhaseOrder: [],
          supportedMiddlewarePhases: {},
          entryDecorators: { controller: 'Controller', handler: ['Get'] },
        },
      },
      handlerIndex: [
        { id: 'b:src/controllers.ts#BController.handle' },
        { id: 'a:src/controllers.ts#AController.handle' },
      ],
    });
    const parsed = JSON.parse(json);
    const parsedRecord = assertRecordValue(parsed as AnalyzerValue);
    const modules = assertArrayValue(parsedRecord.modules);
    const diGraph = assertRecordValue(parsedRecord.diGraph);
    const nodes = assertArrayValue(diGraph.nodes);
    const handlerIndex = assertArrayValue(parsedRecord.handlerIndex);
    const adapterSpecs = assertRecordValue(parsedRecord.adapterStaticSpecs);

    expect(modules.map(entry => assertRecordValue(entry).id)).toEqual(['src/a', 'src/b']);
    expect(nodes.map(entry => assertRecordValue(entry).id)).toEqual(['AModule::AService', 'BModule::BService']);
    expect(Object.keys(adapterSpecs)).toEqual(['a', 'b']);
    expect(handlerIndex.map(entry => assertRecordValue(entry).id)).toEqual([
      'a:src/controllers.ts#AController.handle',
      'b:src/controllers.ts#BController.handle',
    ]);
  });

  it('should generate deterministic module arrays (sorted by id)', () => {
    const moduleNames = ['zeta', 'alpha', 'beta'];
    const fileMap = new Map<string, FileAnalysis>();

    moduleNames.forEach(name => {
      const modulePath = `/app/src/${name}/__module__.ts`;

      fileMap.set(modulePath, {
        filePath: modulePath,
        classes: [],
        reExports: [],
        exports: [],
        defineModuleCalls: [
          {
            callee: 'defineModule',
            importSource: '@zipbul/core',
            args: [],
            exportedName: `${name}Module`,
          },
        ],
        imports: {},
        moduleDefinition: {
          name: `${name}Module`,
          providers: [],
          imports: {},
        },
      });
    });

    const graph = new ModuleGraph(fileMap, '__module__.ts');

    graph.build();

    const gen = new ManifestGenerator();
    const json = gen.generateJson({
      graph,
      projectRoot: '/app',
      source: { path: '/app/zipbul.json', format: 'json' },
      resolvedConfig: {
        module: { fileName: '__module__.ts' },
        sourceDir: 'src',
        entry: 'src/main.ts',
        mcp: { exclude: [] },
      },
      adapterStaticSpecs: {},
      handlerIndex: [],
    });
    const parsed = JSON.parse(json);
    const parsedRecord = assertRecordValue(parsed as AnalyzerValue);
    const modules = assertArrayValue(parsedRecord.modules);
    const ids = modules.map(entry => assertRecordValue(entry).id);

    expect(ids).toEqual(['src/alpha', 'src/beta', 'src/zeta']);
  });



  it('should generate stable JSON output for identical graphs', () => {
    const graph1 = createSingleModuleGraph();
    const graph2 = createSingleModuleGraph();
    const gen = new ManifestGenerator();
    const params = {
      projectRoot: '/app',
      source: { path: '/app/zipbul.json', format: 'json' as const },
      resolvedConfig: {
        module: { fileName: '__module__.ts' },
        sourceDir: 'src',
        entry: 'src/main.ts',
        mcp: { exclude: [] },
      },
      adapterStaticSpecs: {},
      handlerIndex: [],
    };
    const json1 = gen.generateJson({ graph: graph1, ...params });
    const json2 = gen.generateJson({ graph: graph2, ...params });

    expect(json1).toBe(json2);
  });

  it('should generate parseable JSON when graph is empty', () => {
    // Arrange
    const fileMap = new Map<string, FileAnalysis>();
    const graph = new ModuleGraph(fileMap, '__module__.ts');
    const gen = new ManifestGenerator();
    // Act
    const json = gen.generateJson({
      graph,
      projectRoot: '/app',
      source: { path: '/app/zipbul.json', format: 'json' },
      resolvedConfig: {
        module: { fileName: '__module__.ts' },
        sourceDir: 'src',
        entry: 'src/main.ts',
        mcp: { exclude: [] },
      },
      adapterStaticSpecs: {},
      handlerIndex: [],
    });

    // Assert
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('should generate single module manifest', () => {
    const modulePath = '/app/src/app/__module__.ts';
    const fileMap = new Map<string, FileAnalysis>();

    fileMap.set(modulePath, {
      filePath: modulePath,
      classes: [],
      reExports: [],
      exports: [],
      defineModuleCalls: [
        {
          callee: 'defineModule',
          importSource: '@zipbul/core',
          args: [],
          exportedName: 'appModule',
        },
      ],
      imports: {},
      moduleDefinition: {
        name: 'AppModule',
        providers: [],
        imports: {},
      },
    });

    const graph = new ModuleGraph(fileMap, '__module__.ts');

    graph.build();

    const gen = new ManifestGenerator();
    const json = gen.generateJson({
      graph,
      projectRoot: '/app',
      source: { path: '/app/zipbul.json', format: 'json' },
      resolvedConfig: {
        module: { fileName: '__module__.ts' },
        sourceDir: 'src',
        entry: 'src/main.ts',
        mcp: { exclude: [] },
      },
      adapterStaticSpecs: {},
      handlerIndex: [],
    });
    const parsed = JSON.parse(json);
    const parsedRecord = assertRecordValue(parsed as AnalyzerValue);
    const modules = assertArrayValue(parsedRecord.modules);

    expect(modules).toHaveLength(1);

    const appModule = assertRecordValue(modules[0]);

    expect(appModule.id).toBe('src/app');
    expect(appModule.name).toBe('AppModule');
  });

  it('should generate parseable JSON when graph has one module', () => {
    // Arrange
    const graph = createSingleModuleGraph();
    const gen = new ManifestGenerator();
    // Act
    const json = gen.generateJson({
      graph,
      projectRoot: '/app',
      source: { path: '/app/zipbul.json', format: 'json' },
      resolvedConfig: {
        module: { fileName: '__module__.ts' },
        sourceDir: 'src',
        entry: 'src/main.ts',
        mcp: { exclude: [] },
      },
      adapterStaticSpecs: {},
      handlerIndex: [],
    });

    // Assert
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('should include config metadata in JSON output when generated', () => {
    // Arrange
    const graph = createSingleModuleGraph();
    const gen = new ManifestGenerator();
    // Act
    const json = gen.generateJson({
      graph,
      projectRoot: '/app',
      source: { path: '/app/zipbul.json', format: 'json' },
      resolvedConfig: {
        module: { fileName: '__module__.ts' },
        sourceDir: 'src',
        entry: 'src/main.ts',
        mcp: { exclude: [] },
      },
      adapterStaticSpecs: {},
      handlerIndex: [],
    });
    const parsed = JSON.parse(json);
    const parsedRecord = assertRecordValue(parsed as AnalyzerValue);
    // Assert
    const config = assertRecordValue(parsedRecord.config);
    const resolvedModuleConfig = assertRecordValue(config.resolvedModuleConfig);

    expect(config.sourcePath).toBe('/app/zipbul.json');
    expect(config.sourceFormat).toBe('json');
    expect(resolvedModuleConfig.fileName).toBe('__module__.ts');

    expect(parsedRecord).toBeDefined();
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('should generate parseable JSON when adapterStaticSpecs is empty', () => {
    // Arrange
    const graph = createSingleModuleGraph();
    const gen = new ManifestGenerator();
    // Act
    const json = gen.generateJson({
      graph,
      projectRoot: '/app',
      source: { path: '/app/zipbul.json', format: 'json' },
      resolvedConfig: {
        module: { fileName: '__module__.ts' },
        sourceDir: 'src',
        entry: 'src/main.ts',
        mcp: { exclude: [] },
      },
      adapterStaticSpecs: {},
      handlerIndex: [],
    });

    // Assert
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('should generate parseable JSON when projectRoot is /app', () => {
    // Arrange
    const gen = new ManifestGenerator();
    const graph = createSingleModuleGraph();
    // Act
    const json = gen.generateJson({
      graph,
      projectRoot: '/app',
      source: { path: '/app/zipbul.json', format: 'json' },
      resolvedConfig: {
        module: { fileName: '__module__.ts' },
        sourceDir: 'src',
        entry: 'src/main.ts',
        mcp: { exclude: [] },
      },
      adapterStaticSpecs: {},
      handlerIndex: [],
    });

    // Assert
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('should generate parseable JSON when projectRoot is /app/src', () => {
    // Arrange
    const gen = new ManifestGenerator();
    const graph = createSingleModuleGraph();
    // Act
    const json = gen.generateJson({
      graph,
      projectRoot: '/app/src',
      source: { path: '/app/src/zipbul.json', format: 'json' },
      resolvedConfig: {
        module: { fileName: '__module__.ts' },
        sourceDir: 'src',
        entry: 'src/main.ts',
        mcp: { exclude: [] },
      },
      adapterStaticSpecs: {},
      handlerIndex: [],
    });

    // Assert
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('should generate parseable JSON when projectRoot is /', () => {
    // Arrange
    const gen = new ManifestGenerator();
    const graph = createSingleModuleGraph();
    // Act
    const json = gen.generateJson({
      graph,
      projectRoot: '/',
      source: { path: '/zipbul.json', format: 'json' },
      resolvedConfig: {
        module: { fileName: '__module__.ts' },
        sourceDir: 'src',
        entry: 'src/main.ts',
        mcp: { exclude: [] },
      },
      adapterStaticSpecs: {},
      handlerIndex: [],
    });

    // Assert
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('should generate parseable JSON when projectRoot is /Users/dev/project', () => {
    // Arrange
    const gen = new ManifestGenerator();
    const graph = createSingleModuleGraph();
    // Act
    const json = gen.generateJson({
      graph,
      projectRoot: '/Users/dev/project',
      source: { path: '/Users/dev/project/zipbul.json', format: 'json' },
      resolvedConfig: {
        module: { fileName: '__module__.ts' },
        sourceDir: 'src',
        entry: 'src/main.ts',
        mcp: { exclude: [] },
      },
      adapterStaticSpecs: {},
      handlerIndex: [],
    });

    // Assert
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('should generate identical JSON when called twice with the same graph', () => {
    // Arrange
    const gen = new ManifestGenerator();
    const graph1 = createSingleModuleGraph();
    const params = {
      projectRoot: '/app',
      source: { path: '/app/zipbul.json', format: 'json' as const },
      resolvedConfig: {
        module: { fileName: '__module__.ts' },
        sourceDir: 'src',
        entry: 'src/main.ts',
        mcp: { exclude: [] },
      },
      adapterStaticSpecs: {},
      handlerIndex: [],
    };
    // Act
    const json1a = gen.generateJson({ graph: graph1, ...params });
    const json1b = gen.generateJson({ graph: graph1, ...params });

    // Assert
    expect(json1a).toBe(json1b);
  });
});
