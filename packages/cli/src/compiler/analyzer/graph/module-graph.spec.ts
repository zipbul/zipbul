import { describe, expect, it } from 'bun:test';

// MUST: MUST-4 (module boundary resolution deterministic)

import type { ClassMetadata } from '../interfaces';
import type { FileAnalysis } from './interfaces';
import type { ModuleNode } from './module-node';
import type {
  ClassFileAnalysisParams,
  InjectableClassParams,
  ModuleFileAnalysisParams,
} from './module-graph.spec.interfaces';

import { ZIPBUL_CALL, ZIPBUL_IMPORT_SOURCE, ZIPBUL_REF, ZIPBUL_SPREAD, ZIPBUL_UNRESOLVABLE } from '@zipbul/common';
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
  const { filePath, name, exportedName, providers, localValues } = params;
  const analysis: FileAnalysis = {
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
      providers: providers !== undefined ? [...providers] : [],
      imports: {},
    },
  };

  if (localValues !== undefined) {
    analysis.localValues = localValues;
  }

  return analysis;
}

function createClassFileAnalysis(params: ClassFileAnalysisParams): FileAnalysis {
  const { filePath, classes, exportedValues } = params;
  const analysis: FileAnalysis = {
    filePath,
    classes,
    reExports: [],
    exports: [],
    imports: {},
  };

  if (exportedValues !== undefined) {
    analysis.exportedValues = exportedValues;
  }

  return analysis;
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

  describe('spread bundle resolution (F-1)', () => {
    it('should resolve imported bundle with property path', () => {
      const modulePath = '/app/src/app/__module__.ts';
      const bundlePath = '/app/src/app/bundle.ts';
      const fileMap = new Map<string, FileAnalysis>();

      fileMap.set(modulePath, createModuleFileAnalysis({
        filePath: modulePath,
        name: 'AppModule',
        providers: [
          {
            [ZIPBUL_SPREAD]: {
              [ZIPBUL_REF]: 'bundle.providers',
              [ZIPBUL_IMPORT_SOURCE]: bundlePath,
            },
          } as never,
        ],
      }));
      fileMap.set(bundlePath, createClassFileAnalysis({
        filePath: bundlePath,
        classes: [],
        exportedValues: {
          bundle: {
            providers: [
              { [ZIPBUL_REF]: 'TokenA' },
              { [ZIPBUL_REF]: 'TokenB' },
            ],
          },
        },
      }));

      const graph = new ModuleGraph(fileMap, '__module__.ts');
      const modules = graph.build();
      const node = requireNode(modules.get(modulePath));

      expect(node.providers.has('TokenA')).toBe(true);
      expect(node.providers.has('TokenB')).toBe(true);
    });

    it('should resolve local variable spread without property path', () => {
      const modulePath = '/app/src/app/__module__.ts';
      const fileMap = new Map<string, FileAnalysis>();

      fileMap.set(modulePath, createModuleFileAnalysis({
        filePath: modulePath,
        name: 'AppModule',
        providers: [
          {
            [ZIPBUL_SPREAD]: {
              [ZIPBUL_REF]: 'localProviders',
            },
          } as never,
        ],
        localValues: {
          localProviders: [
            { [ZIPBUL_REF]: 'LocalToken' },
          ],
        },
      }));

      const graph = new ModuleGraph(fileMap, '__module__.ts');
      const modules = graph.build();
      const node = requireNode(modules.get(modulePath));

      expect(node.providers.has('LocalToken')).toBe(true);
    });

    it('should resolve inline array spread directly', () => {
      const modulePath = '/app/src/app/__module__.ts';
      const fileMap = new Map<string, FileAnalysis>();

      fileMap.set(modulePath, createModuleFileAnalysis({
        filePath: modulePath,
        name: 'AppModule',
        providers: [
          {
            [ZIPBUL_SPREAD]: [
              { [ZIPBUL_REF]: 'InlineA' },
              { [ZIPBUL_REF]: 'InlineB' },
            ],
          } as never,
        ],
      }));

      const graph = new ModuleGraph(fileMap, '__module__.ts');
      const modules = graph.build();
      const node = requireNode(modules.get(modulePath));

      expect(node.providers.has('InlineA')).toBe(true);
      expect(node.providers.has('InlineB')).toBe(true);
    });

    it('should resolve deep nested property path (obj.a.b.providers)', () => {
      const modulePath = '/app/src/app/__module__.ts';
      const deepPath = '/app/src/app/deep.ts';
      const fileMap = new Map<string, FileAnalysis>();

      fileMap.set(modulePath, createModuleFileAnalysis({
        filePath: modulePath,
        name: 'AppModule',
        providers: [
          {
            [ZIPBUL_SPREAD]: {
              [ZIPBUL_REF]: 'obj.a.b.providers',
              [ZIPBUL_IMPORT_SOURCE]: deepPath,
            },
          } as never,
        ],
      }));
      fileMap.set(deepPath, createClassFileAnalysis({
        filePath: deepPath,
        classes: [],
        exportedValues: {
          obj: {
            a: {
              b: {
                providers: [
                  { [ZIPBUL_REF]: 'DeepToken' },
                ],
              },
            },
          },
        },
      }));

      const graph = new ModuleGraph(fileMap, '__module__.ts');
      const modules = graph.build();
      const node = requireNode(modules.get(modulePath));

      expect(node.providers.has('DeepToken')).toBe(true);
    });

    it('should resolve namespace import by falling back to exported property name', () => {
      const modulePath = '/app/src/app/__module__.ts';
      const nsPath = '/app/src/app/ns.ts';
      const fileMap = new Map<string, FileAnalysis>();

      fileMap.set(modulePath, createModuleFileAnalysis({
        filePath: modulePath,
        name: 'AppModule',
        providers: [
          {
            [ZIPBUL_SPREAD]: {
              [ZIPBUL_REF]: 'ns.providers',
              [ZIPBUL_IMPORT_SOURCE]: nsPath,
            },
          } as never,
        ],
      }));
      fileMap.set(nsPath, createClassFileAnalysis({
        filePath: nsPath,
        classes: [],
        exportedValues: {
          providers: [
            { [ZIPBUL_REF]: 'NsToken' },
          ],
        },
      }));

      const graph = new ModuleGraph(fileMap, '__module__.ts');
      const modules = graph.build();
      const node = requireNode(modules.get(modulePath));

      expect(node.providers.has('NsToken')).toBe(true);
    });

    it('should flatten nested spread recursively', () => {
      const modulePath = '/app/src/app/__module__.ts';
      const fileMap = new Map<string, FileAnalysis>();

      fileMap.set(modulePath, createModuleFileAnalysis({
        filePath: modulePath,
        name: 'AppModule',
        providers: [
          {
            [ZIPBUL_SPREAD]: [
              { [ZIPBUL_SPREAD]: [{ [ZIPBUL_REF]: 'NestedA' }] },
              { [ZIPBUL_REF]: 'TopC' },
            ],
          } as never,
        ],
      }));

      const graph = new ModuleGraph(fileMap, '__module__.ts');
      const modules = graph.build();
      const node = requireNode(modules.get(modulePath));

      expect(node.providers.has('NestedA')).toBe(true);
      expect(node.providers.has('TopC')).toBe(true);
    });

    it('should resolve re-export chain via gildash resolveSymbol', () => {
      const modulePath = '/app/src/app/__module__.ts';
      const reexportPath = '/app/src/app/reexport.ts';
      const originalPath = '/app/src/app/original.ts';
      const fileMap = new Map<string, FileAnalysis>();

      fileMap.set(modulePath, createModuleFileAnalysis({
        filePath: modulePath,
        name: 'AppModule',
        providers: [
          {
            [ZIPBUL_SPREAD]: {
              [ZIPBUL_REF]: 'bundle.providers',
              [ZIPBUL_IMPORT_SOURCE]: reexportPath,
            },
          } as never,
        ],
      }));
      fileMap.set(reexportPath, createClassFileAnalysis({
        filePath: reexportPath,
        classes: [],
      }));
      fileMap.set(originalPath, createClassFileAnalysis({
        filePath: originalPath,
        classes: [],
        exportedValues: {
          bundle: {
            providers: [
              { [ZIPBUL_REF]: 'ReExportedToken' },
            ],
          },
        },
      }));

      const mockGildash = {
        resolveSymbol: (name: string, _source: string) => ({
          originalName: name,
          filePath: originalPath,
          circular: false,
        }),
      };

      const graph = new ModuleGraph(fileMap, '__module__.ts', undefined, mockGildash as never);
      const modules = graph.build();
      const node = requireNode(modules.get(modulePath));

      expect(node.providers.has('ReExportedToken')).toBe(true);
    });

    it('should accept empty spread array without error', () => {
      const modulePath = '/app/src/app/__module__.ts';
      const fileMap = new Map<string, FileAnalysis>();

      fileMap.set(modulePath, createModuleFileAnalysis({
        filePath: modulePath,
        name: 'AppModule',
        providers: [
          { [ZIPBUL_SPREAD]: [] } as never,
        ],
      }));

      const graph = new ModuleGraph(fileMap, '__module__.ts');
      const modules = graph.build();
      const node = requireNode(modules.get(modulePath));

      expect(node.providers.size).toBe(0);
    });

    it('should merge spread providers with normal providers in same module', () => {
      const modulePath = '/app/src/app/__module__.ts';
      const servicePath = '/app/src/app/existing.service.ts';
      const bundlePath = '/app/src/app/bundle.ts';
      const fileMap = new Map<string, FileAnalysis>();

      fileMap.set(modulePath, createModuleFileAnalysis({
        filePath: modulePath,
        name: 'AppModule',
        providers: [
          { [ZIPBUL_REF]: 'ExplicitToken' } as never,
          {
            [ZIPBUL_SPREAD]: {
              [ZIPBUL_REF]: 'bundle.providers',
              [ZIPBUL_IMPORT_SOURCE]: bundlePath,
            },
          } as never,
        ],
      }));
      fileMap.set(servicePath, createClassFileAnalysis({
        filePath: servicePath,
        classes: [createInjectableClassMetadata({ className: 'ExistingService' })],
      }));
      fileMap.set(bundlePath, createClassFileAnalysis({
        filePath: bundlePath,
        classes: [],
        exportedValues: {
          bundle: {
            providers: [
              { [ZIPBUL_REF]: 'SpreadToken' },
            ],
          },
        },
      }));

      const graph = new ModuleGraph(fileMap, '__module__.ts');
      const modules = graph.build();
      const node = requireNode(modules.get(modulePath));

      expect(node.providers.has('ExistingService')).toBe(true);
      expect(node.providers.has('ExplicitToken')).toBe(true);
      expect(node.providers.has('SpreadToken')).toBe(true);
    });

    it('should resolve multiple spreads in same providers array', () => {
      const modulePath = '/app/src/app/__module__.ts';
      const bundleAPath = '/app/src/app/bundle-a.ts';
      const bundleBPath = '/app/src/app/bundle-b.ts';
      const fileMap = new Map<string, FileAnalysis>();

      fileMap.set(modulePath, createModuleFileAnalysis({
        filePath: modulePath,
        name: 'AppModule',
        providers: [
          {
            [ZIPBUL_SPREAD]: {
              [ZIPBUL_REF]: 'bundleA.providers',
              [ZIPBUL_IMPORT_SOURCE]: bundleAPath,
            },
          } as never,
          {
            [ZIPBUL_SPREAD]: {
              [ZIPBUL_REF]: 'bundleB.providers',
              [ZIPBUL_IMPORT_SOURCE]: bundleBPath,
            },
          } as never,
        ],
      }));
      fileMap.set(bundleAPath, createClassFileAnalysis({
        filePath: bundleAPath,
        classes: [],
        exportedValues: {
          bundleA: { providers: [{ [ZIPBUL_REF]: 'FromA' }] },
        },
      }));
      fileMap.set(bundleBPath, createClassFileAnalysis({
        filePath: bundleBPath,
        classes: [],
        exportedValues: {
          bundleB: { providers: [{ [ZIPBUL_REF]: 'FromB' }] },
        },
      }));

      const graph = new ModuleGraph(fileMap, '__module__.ts');
      const modules = graph.build();
      const node = requireNode(modules.get(modulePath));

      expect(node.providers.has('FromA')).toBe(true);
      expect(node.providers.has('FromB')).toBe(true);
    });

    it('should throw when spread resolves to function call (ZIPBUL_CALL)', () => {
      const modulePath = '/app/src/app/__module__.ts';
      const fileMap = new Map<string, FileAnalysis>();

      fileMap.set(modulePath, createModuleFileAnalysis({
        filePath: modulePath,
        name: 'AppModule',
        providers: [
          {
            [ZIPBUL_SPREAD]: {
              [ZIPBUL_CALL]: 'getProviders',
              [ZIPBUL_IMPORT_SOURCE]: '/app/src/app/fn.ts',
              args: [],
            },
          } as never,
        ],
      }));

      const graph = new ModuleGraph(fileMap, '__module__.ts');

      expect(() => graph.build()).toThrow(/스프레드 표현식.*정적으로 해석할 수 없습니다/);
      expect(() => graph.build()).toThrow(/함수 호출/);
      expect(() => graph.build()).toThrow(/해결:/);
    });

    it('should throw when spread is unresolvable expression with reason and solution', () => {
      const modulePath = '/app/src/app/__module__.ts';
      const fileMap = new Map<string, FileAnalysis>();

      fileMap.set(modulePath, createModuleFileAnalysis({
        filePath: modulePath,
        name: 'AppModule',
        providers: [
          {
            [ZIPBUL_SPREAD]: {
              [ZIPBUL_UNRESOLVABLE]: true,
              nodeType: 'ConditionalExpression',
            },
          } as never,
        ],
      }));

      const graph = new ModuleGraph(fileMap, '__module__.ts');

      expect(() => graph.build()).toThrow(/원인:.*ConditionalExpression/);
      expect(() => graph.build()).toThrow(/해결:/);
    });

    it('should throw when resolved spread value is not an array', () => {
      const modulePath = '/app/src/app/__module__.ts';
      const bundlePath = '/app/src/app/bundle.ts';
      const fileMap = new Map<string, FileAnalysis>();

      fileMap.set(modulePath, createModuleFileAnalysis({
        filePath: modulePath,
        name: 'AppModule',
        providers: [
          {
            [ZIPBUL_SPREAD]: {
              [ZIPBUL_REF]: 'bundle.providers',
              [ZIPBUL_IMPORT_SOURCE]: bundlePath,
            },
          } as never,
        ],
      }));
      fileMap.set(bundlePath, createClassFileAnalysis({
        filePath: bundlePath,
        classes: [],
        exportedValues: {
          bundle: {
            providers: 'not-an-array',
          },
        },
      }));

      const graph = new ModuleGraph(fileMap, '__module__.ts');

      expect(() => graph.build()).toThrow(/해석된 값이 배열이 아닙니다/);
    });

    it('should throw when property path segment is missing', () => {
      const modulePath = '/app/src/app/__module__.ts';
      const bundlePath = '/app/src/app/bundle.ts';
      const fileMap = new Map<string, FileAnalysis>();

      fileMap.set(modulePath, createModuleFileAnalysis({
        filePath: modulePath,
        name: 'AppModule',
        providers: [
          {
            [ZIPBUL_SPREAD]: {
              [ZIPBUL_REF]: 'bundle.nonexistent',
              [ZIPBUL_IMPORT_SOURCE]: bundlePath,
            },
          } as never,
        ],
      }));
      fileMap.set(bundlePath, createClassFileAnalysis({
        filePath: bundlePath,
        classes: [],
        exportedValues: {
          bundle: { other: [] },
        },
      }));

      const graph = new ModuleGraph(fileMap, '__module__.ts');

      expect(() => graph.build()).toThrow(/프로퍼티 'nonexistent'를 찾을 수 없습니다/);
    });

    it('should throw when local variable does not exist', () => {
      const modulePath = '/app/src/app/__module__.ts';
      const fileMap = new Map<string, FileAnalysis>();

      fileMap.set(modulePath, createModuleFileAnalysis({
        filePath: modulePath,
        name: 'AppModule',
        providers: [
          {
            [ZIPBUL_SPREAD]: {
              [ZIPBUL_REF]: 'nonExistentVar',
            },
          } as never,
        ],
        localValues: {},
      }));

      const graph = new ModuleGraph(fileMap, '__module__.ts');

      expect(() => graph.build()).toThrow(/로컬 변수 'nonExistentVar'를 찾을 수 없습니다/);
    });

    it('should throw when spread value is a primitive', () => {
      const modulePath = '/app/src/app/__module__.ts';
      const fileMap = new Map<string, FileAnalysis>();

      fileMap.set(modulePath, createModuleFileAnalysis({
        filePath: modulePath,
        name: 'AppModule',
        providers: [
          { [ZIPBUL_SPREAD]: 42 } as never,
        ],
      }));

      const graph = new ModuleGraph(fileMap, '__module__.ts');

      expect(() => graph.build()).toThrow(/스프레드 표현식.*정적으로 해석할 수 없습니다/);
    });

    it('should throw when property path traverses a non-object value', () => {
      const modulePath = '/app/src/app/__module__.ts';
      const bundlePath = '/app/src/app/bundle.ts';
      const fileMap = new Map<string, FileAnalysis>();

      fileMap.set(modulePath, createModuleFileAnalysis({
        filePath: modulePath,
        name: 'AppModule',
        providers: [
          {
            [ZIPBUL_SPREAD]: {
              [ZIPBUL_REF]: 'bundle.deep.providers',
              [ZIPBUL_IMPORT_SOURCE]: bundlePath,
            },
          } as never,
        ],
      }));
      fileMap.set(bundlePath, createClassFileAnalysis({
        filePath: bundlePath,
        classes: [],
        exportedValues: {
          bundle: {
            deep: 'string-not-object',
          },
        },
      }));

      const graph = new ModuleGraph(fileMap, '__module__.ts');

      expect(() => graph.build()).toThrow(/프로퍼티 'providers' 접근 대상이 객체가 아닙니다/);
    });

    it('should throw when imported file has no exported values', () => {
      const modulePath = '/app/src/app/__module__.ts';
      const emptyPath = '/app/src/app/empty.ts';
      const fileMap = new Map<string, FileAnalysis>();

      fileMap.set(modulePath, createModuleFileAnalysis({
        filePath: modulePath,
        name: 'AppModule',
        providers: [
          {
            [ZIPBUL_SPREAD]: {
              [ZIPBUL_REF]: 'bundle.providers',
              [ZIPBUL_IMPORT_SOURCE]: emptyPath,
            },
          } as never,
        ],
      }));
      fileMap.set(emptyPath, createClassFileAnalysis({
        filePath: emptyPath,
        classes: [],
      }));

      const graph = new ModuleGraph(fileMap, '__module__.ts');

      expect(() => graph.build()).toThrow(/exported values를 찾을 수 없습니다/);
    });

    it('should include module name and file path in all error messages', () => {
      const modulePath = '/app/src/app/__module__.ts';
      const fileMap = new Map<string, FileAnalysis>();

      fileMap.set(modulePath, createModuleFileAnalysis({
        filePath: modulePath,
        name: 'AppModule',
        providers: [
          { [ZIPBUL_SPREAD]: null } as never,
        ],
      }));

      const graph = new ModuleGraph(fileMap, '__module__.ts');

      expect(() => graph.build()).toThrow(/AppModule/);
      expect(() => graph.build()).toThrow(/\/app\/src\/app\/__module__\.ts/);
    });

    it('should resolve file with .ts extension fallback in findFileAnalysis', () => {
      const modulePath = '/app/src/app/__module__.ts';
      const bundlePath = '/app/src/app/bundle.ts';
      const fileMap = new Map<string, FileAnalysis>();

      fileMap.set(modulePath, createModuleFileAnalysis({
        filePath: modulePath,
        name: 'AppModule',
        providers: [
          {
            [ZIPBUL_SPREAD]: {
              [ZIPBUL_REF]: 'bundle.providers',
              [ZIPBUL_IMPORT_SOURCE]: '/app/src/app/bundle',
            },
          } as never,
        ],
      }));
      fileMap.set(bundlePath, createClassFileAnalysis({
        filePath: bundlePath,
        classes: [],
        exportedValues: {
          bundle: {
            providers: [
              { [ZIPBUL_REF]: 'FallbackToken' },
            ],
          },
        },
      }));

      const graph = new ModuleGraph(fileMap, '__module__.ts');
      const modules = graph.build();
      const node = requireNode(modules.get(modulePath));

      expect(node.providers.has('FallbackToken')).toBe(true);
    });
  });
});

