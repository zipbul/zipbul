import { describe, expect, it } from 'bun:test';

// MUST: MUST-4 (모듈 경계 판정 deterministic)

import type { ClassMetadata } from '../interfaces';
import type { FileAnalysis } from './interfaces';
import type { ModuleNode } from './module-node';
import type {
  ClassFileAnalysisParams,
  InjectableClassParams,
  ModuleFileAnalysisParams,
} from './module-graph.spec.interfaces';

import { ModuleGraph } from './module-graph';

const requireNode = (node: ModuleNode | undefined): ModuleNode => {
  if (!node) {
    throw new Error('Expected module node to exist.');
  }

  return node;
};

function createInjectableClassMetadata(params: InjectableClassParams): ClassMetadata {
  const { className, injectedTokens, visibleTo, scope } = params;
  const constructorParams = (injectedTokens ?? []).map((token, index) => {
    return {
      name: `p${index}`,
      type: { __zipbul_ref: token },
      decorators: [],
    };
  });

  return {
    className,
    heritage: undefined,
    decorators: [
      {
        name: 'Injectable',
        arguments: [{ visibleTo: visibleTo ?? 'all', scope: scope ?? 'singleton' }],
      },
    ],
    constructorParams,
    methods: [],
    properties: [],
    imports: {},
  };
}

function createModuleFileAnalysis(params: ModuleFileAnalysisParams): FileAnalysis {
  const { filePath, name, exportedName } = params;

  return {
    filePath,
    classes: [],
    reExports: [],
    exports: [],
    imports: {},
    defineModuleCalls: [
      {
        callee: 'defineModule',
        importSource: '@zipbul/core',
        args: [],
        exportedName: exportedName ?? 'appModule',
      },
    ],
    moduleDefinition: {
      name,
      providers: [],
      imports: {},
    },
  };
}

function createClassFileAnalysis(params: ClassFileAnalysisParams): FileAnalysis {
  const { filePath, classes } = params;

  return {
    filePath,
    classes,
    reExports: [],
    exports: [],
    imports: {},
  };
}

describe('ModuleGraph', () => {
  it('should be deterministic when fileMap insertion order differs', () => {
    // Arrange
    const modulePath = '/app/src/a/__module__.ts';
    const servicePath = '/app/src/a/a.service.ts';
    const moduleFile = createModuleFileAnalysis({ filePath: modulePath, name: 'AModule' });
    const serviceFile = createClassFileAnalysis({
      filePath: servicePath,
      classes: [createInjectableClassMetadata({ className: 'AService' })],
    });
    const fileMap1 = new Map<string, FileAnalysis>();

    fileMap1.set(servicePath, serviceFile);

    fileMap1.set(modulePath, moduleFile);

    const fileMap2 = new Map<string, FileAnalysis>();

    fileMap2.set(modulePath, moduleFile);

    fileMap2.set(servicePath, serviceFile);

    const graph1 = new ModuleGraph(fileMap1, '__module__.ts');
    const graph2 = new ModuleGraph(fileMap2, '__module__.ts');
    // Act
    const modules1 = graph1.build();
    const modules2 = graph2.build();

    // Assert
    expect(Array.from(modules1.keys())).toEqual(Array.from(modules2.keys()));

    const node1 = requireNode(modules1.get(modulePath));
    const node2 = requireNode(modules2.get(modulePath));

    expect(node1.name).toBe('AModule');

    expect(node2.name).toBe('AModule');
    expect(Array.from(node1.providers.keys())).toEqual(['AService']);
    expect(Array.from(node2.providers.keys())).toEqual(['AService']);
  });

  it('should throw when a circular dependency exists between modules', () => {
    // Arrange
    const moduleAPath = '/app/src/a/__module__.ts';
    const moduleBPath = '/app/src/b/__module__.ts';
    const serviceAPath = '/app/src/a/a.service.ts';
    const serviceBPath = '/app/src/b/b.service.ts';
    const fileMap = new Map<string, FileAnalysis>();

    fileMap.set(moduleAPath, createModuleFileAnalysis({ filePath: moduleAPath, name: 'AModule' }));
    fileMap.set(moduleBPath, createModuleFileAnalysis({ filePath: moduleBPath, name: 'BModule' }));
    fileMap.set(
      serviceAPath,
      createClassFileAnalysis({
        filePath: serviceAPath,
        classes: [createInjectableClassMetadata({ className: 'AService', injectedTokens: ['BService'] })],
      }),
    );
    fileMap.set(
      serviceBPath,
      createClassFileAnalysis({
        filePath: serviceBPath,
        classes: [createInjectableClassMetadata({ className: 'BService', injectedTokens: ['AService'] })],
      }),
    );

    // Act
    const graph = new ModuleGraph(fileMap, '__module__.ts');

    // Assert
    expect(() => graph.build()).toThrow(/Circular dependency detected/);
  });

  it('should throw when visibleTo disallows cross-module injection', () => {
    const moduleAPath = '/app/src/a/__module__.ts';
    const moduleBPath = '/app/src/b/__module__.ts';
    const moduleOtherPath = '/app/src/other/__module__.ts';
    const serviceAPath = '/app/src/a/a.service.ts';
    const serviceBPath = '/app/src/b/b.service.ts';
    const fileMap = new Map<string, FileAnalysis>();

    fileMap.set(moduleAPath, createModuleFileAnalysis({ filePath: moduleAPath, name: 'AModule', exportedName: 'appModule' }));
    fileMap.set(moduleBPath, createModuleFileAnalysis({ filePath: moduleBPath, name: 'BModule', exportedName: 'bModule' }));
    fileMap.set(
      moduleOtherPath,
      createModuleFileAnalysis({ filePath: moduleOtherPath, name: 'OtherModule', exportedName: 'otherModule' }),
    );
    fileMap.set(
      serviceAPath,
      createClassFileAnalysis({
        filePath: serviceAPath,
        classes: [createInjectableClassMetadata({ className: 'AService', injectedTokens: ['BService'] })],
      }),
    );
    fileMap.set(
      serviceBPath,
      createClassFileAnalysis({
        filePath: serviceBPath,
        classes: [
          createInjectableClassMetadata({
            className: 'BService',
            visibleTo: [
              { __zipbul_ref: 'otherModule', __zipbul_import_source: moduleOtherPath },
            ],
          }),
        ],
      }),
    );

    const graph = new ModuleGraph(fileMap, '__module__.ts');

    expect(() => graph.build()).toThrow(/Visibility Violation/);
  });

  it('should normalize visibleTo allowlist with duplicates', () => {
    const moduleAPath = '/app/src/a/__module__.ts';
    const moduleBPath = '/app/src/b/__module__.ts';
    const serviceAPath = '/app/src/a/a.service.ts';
    const serviceBPath = '/app/src/b/b.service.ts';
    const fileMap = new Map<string, FileAnalysis>();

    fileMap.set(moduleAPath, createModuleFileAnalysis({ filePath: moduleAPath, name: 'AModule', exportedName: 'appModule' }));
    fileMap.set(moduleBPath, createModuleFileAnalysis({ filePath: moduleBPath, name: 'BModule', exportedName: 'bModule' }));
    fileMap.set(
      serviceAPath,
      createClassFileAnalysis({
        filePath: serviceAPath,
        classes: [createInjectableClassMetadata({ className: 'AService', injectedTokens: ['BService'] })],
      }),
    );
    fileMap.set(
      serviceBPath,
      createClassFileAnalysis({
        filePath: serviceBPath,
        classes: [
          createInjectableClassMetadata({
            className: 'BService',
            visibleTo: [
              { __zipbul_ref: 'appModule', __zipbul_import_source: moduleAPath },
              { __zipbul_ref: 'appModule', __zipbul_import_source: moduleAPath },
            ],
          }),
        ],
      }),
    );

    const graph = new ModuleGraph(fileMap, '__module__.ts');
    const modules = graph.build();
    const moduleNode = requireNode(modules.get(moduleBPath));
    const provider = moduleNode.providers.get('BService');

    expect(provider?.visibleTo).toEqual(['AModule']);
  });

  it('should throw when singleton injects request-scoped provider', () => {
    const moduleAPath = '/app/src/a/__module__.ts';
    const moduleBPath = '/app/src/b/__module__.ts';
    const serviceAPath = '/app/src/a/a.service.ts';
    const serviceBPath = '/app/src/b/b.service.ts';
    const fileMap = new Map<string, FileAnalysis>();

    fileMap.set(moduleAPath, createModuleFileAnalysis({ filePath: moduleAPath, name: 'AModule', exportedName: 'appModule' }));
    fileMap.set(moduleBPath, createModuleFileAnalysis({ filePath: moduleBPath, name: 'BModule', exportedName: 'bModule' }));
    fileMap.set(
      serviceAPath,
      createClassFileAnalysis({
        filePath: serviceAPath,
        classes: [createInjectableClassMetadata({ className: 'AService', injectedTokens: ['BService'] })],
      }),
    );
    fileMap.set(
      serviceBPath,
      createClassFileAnalysis({
        filePath: serviceBPath,
        classes: [
          createInjectableClassMetadata({ className: 'BService', scope: 'request', visibleTo: 'all' }),
        ],
      }),
    );

    const graph = new ModuleGraph(fileMap, '__module__.ts');

    expect(() => graph.build()).toThrow(/Scope Violation/);
  });

  it('should throw when inject() tokens are invalid', () => {
    const modulePath = '/app/src/app/__module__.ts';
    const filePath = '/app/src/app/file.ts';
    const fileMap = new Map<string, FileAnalysis>();

    fileMap.set(modulePath, createModuleFileAnalysis({ filePath: modulePath, name: 'AppModule', exportedName: 'appModule' }));
    fileMap.set(filePath, {
      filePath,
      classes: [],
      reExports: [],
      exports: [],
      imports: {},
      injectCalls: [
        {
          tokenKind: 'invalid',
          token: null,
          callee: 'inject',
          importSource: '@zipbul/common',
        },
      ],
    });

    const graph = new ModuleGraph(fileMap, '__module__.ts');

    expect(() => graph.build()).toThrow(/inject\(\) token is not statically determinable/);
  });

  it('should throw when module file is missing defineModule call', () => {
    const modulePath = '/app/src/app/__module__.ts';
    const fileMap = new Map<string, FileAnalysis>();

    fileMap.set(modulePath, {
      filePath: modulePath,
      classes: [],
      reExports: [],
      exports: [],
      imports: {},
    });

    const graph = new ModuleGraph(fileMap, '__module__.ts');

    expect(() => graph.build()).toThrow(/Missing defineModule call/);
  });

  it('should throw when module has multiple defineModule calls', () => {
    const modulePath = '/app/src/app/__module__.ts';
    const fileMap = new Map<string, FileAnalysis>();

    fileMap.set(modulePath, {
      filePath: modulePath,
      classes: [],
      reExports: [],
      exports: [],
      imports: {},
      defineModuleCalls: [
        {
          callee: 'defineModule',
          importSource: '@zipbul/core',
          args: [],
          exportedName: 'module1',
        },
        {
          callee: 'defineModule',
          importSource: '@zipbul/core',
          args: [],
          exportedName: 'module2',
        },
      ],
    });

    const graph = new ModuleGraph(fileMap, '__module__.ts');

    expect(() => graph.build()).toThrow(/Multiple defineModule calls/);
  });

  it('should throw when defineModule call is not exported', () => {
    const modulePath = '/app/src/app/__module__.ts';
    const fileMap = new Map<string, FileAnalysis>();

    fileMap.set(modulePath, {
      filePath: modulePath,
      classes: [],
      reExports: [],
      exports: [],
      imports: {},
      defineModuleCalls: [
        {
          callee: 'defineModule',
          importSource: '@zipbul/core',
          args: [],
          exportedName: undefined,
        },
      ],
    });

    const graph = new ModuleGraph(fileMap, '__module__.ts');

    expect(() => graph.build()).toThrow(/Module marker must be exported/);
  });

  it('should throw when a provider token cannot be determined (A-7)', () => {
    const modulePath = '/app/src/app/__module__.ts';
    const fileMap = new Map<string, FileAnalysis>();

    fileMap.set(modulePath, {
      filePath: modulePath,
      classes: [],
      reExports: [],
      exports: [],
      imports: {},
      defineModuleCalls: [
        {
          callee: 'defineModule',
          importSource: '@zipbul/core',
          args: [],
          exportedName: 'appModule',
        },
      ],
      moduleDefinition: {
        name: 'AppModule',
        providers: [42 as never],
        imports: {},
      },
    });

    const graph = new ModuleGraph(fileMap, '__module__.ts');

    expect(() => graph.build()).toThrow(/Cannot determine provider token/);
  });

  it('should throw when a provider is an unresolvable expression (A-7)', () => {
    const modulePath = '/app/src/app/__module__.ts';
    const fileMap = new Map<string, FileAnalysis>();

    fileMap.set(modulePath, {
      filePath: modulePath,
      classes: [],
      reExports: [],
      exports: [],
      imports: {},
      defineModuleCalls: [
        {
          callee: 'defineModule',
          importSource: '@zipbul/core',
          args: [],
          exportedName: 'appModule',
        },
      ],
      moduleDefinition: {
        name: 'AppModule',
        providers: [{ __zipbul_unresolvable: true, nodeType: 'CallExpression' } as never],
        imports: {},
      },
    });

    const graph = new ModuleGraph(fileMap, '__module__.ts');

    expect(() => graph.build()).toThrow(/provider must be a class reference or provider object/);
  });

  it('should throw when two modules have the same name (F-4)', () => {
    const moduleAPath = '/app/src/a/__module__.ts';
    const moduleBPath = '/app/src/b/__module__.ts';
    const fileMap = new Map<string, FileAnalysis>();

    fileMap.set(
      moduleAPath,
      createModuleFileAnalysis({ filePath: moduleAPath, name: 'SharedName', exportedName: 'aModule' }),
    );
    fileMap.set(
      moduleBPath,
      createModuleFileAnalysis({ filePath: moduleBPath, name: 'SharedName', exportedName: 'bModule' }),
    );

    const graph = new ModuleGraph(fileMap, '__module__.ts');

    expect(() => graph.build()).toThrow(/Duplicate module name/);
  });

  it('should return all scoped keys from getAllRegisteredKeys()', () => {
    const moduleAPath = '/app/src/a/__module__.ts';
    const moduleBPath = '/app/src/b/__module__.ts';
    const serviceAPath = '/app/src/a/a.service.ts';
    const serviceBPath = '/app/src/b/b.service.ts';
    const serviceCPath = '/app/src/b/c.service.ts';
    const fileMap = new Map<string, FileAnalysis>();

    fileMap.set(moduleAPath, createModuleFileAnalysis({ filePath: moduleAPath, name: 'AModule', exportedName: 'aModule' }));
    fileMap.set(moduleBPath, createModuleFileAnalysis({ filePath: moduleBPath, name: 'BModule', exportedName: 'bModule' }));
    fileMap.set(
      serviceAPath,
      createClassFileAnalysis({
        filePath: serviceAPath,
        classes: [createInjectableClassMetadata({ className: 'AService' })],
      }),
    );
    fileMap.set(
      serviceBPath,
      createClassFileAnalysis({
        filePath: serviceBPath,
        classes: [createInjectableClassMetadata({ className: 'BService' })],
      }),
    );
    fileMap.set(
      serviceCPath,
      createClassFileAnalysis({
        filePath: serviceCPath,
        classes: [createInjectableClassMetadata({ className: 'CService' })],
      }),
    );

    const graph = new ModuleGraph(fileMap, '__module__.ts');

    graph.build();

    const keys = graph.getAllRegisteredKeys();

    expect(keys).toBeInstanceOf(Set);
    expect(keys.has('AModule::AService')).toBe(true);
    expect(keys.has('BModule::BService')).toBe(true);
    expect(keys.has('BModule::CService')).toBe(true);
    expect(keys.size).toBe(3);
  });

  it('should throw when useFactory inject tokens are invalid (H-1)', () => {
    const modulePath = '/app/src/app/__module__.ts';
    const fileMap = new Map<string, FileAnalysis>();

    fileMap.set(modulePath, {
      filePath: modulePath,
      classes: [],
      reExports: [],
      exports: [],
      imports: {},
      defineModuleCalls: [
        {
          callee: 'defineModule',
          importSource: '@zipbul/core',
          args: [],
          exportedName: 'appModule',
        },
      ],
      moduleDefinition: {
        name: 'AppModule',
        providers: [
          {
            provide: 'ConfigService',
            useFactory: {
              __zipbul_factory_injects: [
                { tokenKind: 'invalid', token: null },
              ],
            },
          } as never,
        ],
        imports: {},
      },
    });

    const graph = new ModuleGraph(fileMap, '__module__.ts');

    expect(() => graph.build()).toThrow(/inject\(\) token in useFactory of provider 'ConfigService'/);
  });

  it('should throw when useFactory inject token is null (H-1)', () => {
    const modulePath = '/app/src/app/__module__.ts';
    const fileMap = new Map<string, FileAnalysis>();

    fileMap.set(modulePath, {
      filePath: modulePath,
      classes: [],
      reExports: [],
      exports: [],
      imports: {},
      defineModuleCalls: [
        {
          callee: 'defineModule',
          importSource: '@zipbul/core',
          args: [],
          exportedName: 'appModule',
        },
      ],
      moduleDefinition: {
        name: 'AppModule',
        providers: [
          {
            provide: 'DbService',
            useFactory: {
              __zipbul_factory_injects: [
                { tokenKind: 'token', token: null },
              ],
            },
          } as never,
        ],
        imports: {},
      },
    });

    const graph = new ModuleGraph(fileMap, '__module__.ts');

    expect(() => graph.build()).toThrow(/inject\(\) token in useFactory of provider 'DbService'/);
  });
});

