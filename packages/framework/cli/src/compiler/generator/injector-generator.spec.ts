import { describe, expect, it } from 'bun:test';

// MUST: MUST-1 (createApplication identification)
// MUST: MUST-5 (DI cycle detection → build failure)

import type { FileAnalysis } from '../analyzer/graph/interfaces';
import type { ClassMetadata } from '../analyzer/interfaces';

import { isErr } from '@zipbul/result';
import { unwrapOk } from '../../../test/shared/assertions';
import { ModuleGraph } from '../analyzer/graph/module-graph';
import { ImportRegistry } from './import-registry';
import { InjectorGenerator } from './injector-generator';

function createEmptyGraph(): ModuleGraph {
  const fileMap = new Map<string, FileAnalysis>();
  const graph = new ModuleGraph(fileMap, '__module__.ts');

  return graph;
}

function createInjectableClassMetadata(className: string): ClassMetadata {
  return {
    className,
    heritage: undefined,
    decorators: [{ name: 'Injectable', arguments: [{ visibleTo: 'all', scope: 'singleton' }] }],
    methods: [],
    properties: [],
    imports: {},
  };
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

describe('InjectorGenerator', () => {
  describe('generate', () => {
    it('should generate a container factory when graph has no modules', () => {
      // Arrange
      const graph = createEmptyGraph();
      const registry = new ImportRegistry('/app/src');
      const generator = new InjectorGenerator();
      // Act
      const result = generator.generate(graph, registry);

      // Assert
      expect(result).toContain('export function createContainer()');
      expect(result).toContain('const container = new Container()');
    });

    it('should include adapterConfig export when generating injector code', () => {
      // Arrange
      const graph = createSingleModuleGraph();
      const registry = new ImportRegistry('/app/src');
      const generator = new InjectorGenerator();
      // Act
      const result = generator.generate(graph, registry);

      // Assert
      expect(result).toContain('adapterConfig');
      expect(result).toContain('deepFreeze');
    });

    it('should not duplicate identical import statements when generating injector code', () => {
      // Arrange
      const graph = createSingleModuleGraph();
      const registry = new ImportRegistry('/app/src');
      const generator = new InjectorGenerator();
      // Act
      const result = unwrapOk(generator.generate(graph, registry));
      const importLines = result
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('import '));

      // Assert
      expect(new Set(importLines).size).toBe(importLines.length);
    });

    it('should be deterministic when generating with the same graph twice', () => {
      // Arrange
      const graph = createSingleModuleGraph();
      const registry = new ImportRegistry('/app/src');
      const generator = new InjectorGenerator();
      // Act
      const result1 = generator.generate(graph, registry);
      const result2 = generator.generate(graph, registry);

      // Assert
      expect(result1).toBe(result2);
    });

    it('should not throw when registry root differs from project root', () => {
      // Arrange
      const graph = createSingleModuleGraph();
      const registry = new ImportRegistry('/other/root');
      const generator = new InjectorGenerator();

      // Act & Assert
      expect(() => generator.generate(graph, registry)).not.toThrow();
    });
  });

  describe('guard serialization', () => {
    it('should serialize guards field when present in adapter module config', () => {
      // Arrange
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
          adapters: [
            {
              adapter: { __zipbul_ref: 'HttpAdapter', __zipbul_import_source: '@zipbul/http-adapter' },
              name: 'http',
              guards: [
                { __zipbul_ref: 'AuthGuard', __zipbul_import_source: '/app/src/guards/auth-guard.ts' },
              ],
            },
          ],
        },
      });

      const graph = new ModuleGraph(fileMap, '__module__.ts');

      graph.build();

      const registry = new ImportRegistry('/app/src');
      const generator = new InjectorGenerator();

      // Act
      const result = generator.generate(graph, registry);

      // Assert
      if (isErr(result)) {
        throw new Error('Expected successful generation');
      }

      expect(result).toContain("'guards':");
    });

    it('should not include guards in output when guards is absent', () => {
      // Arrange
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
          adapters: [
            {
              adapter: { __zipbul_ref: 'HttpAdapter', __zipbul_import_source: '@zipbul/http-adapter' },
              name: 'http',
              middlewares: [
                { __zipbul_ref: 'LogMiddleware', __zipbul_import_source: '/app/src/middlewares/log.ts' },
              ],
            },
          ],
        },
      });

      const graph = new ModuleGraph(fileMap, '__module__.ts');

      graph.build();

      const registry = new ImportRegistry('/app/src');
      const generator = new InjectorGenerator();

      // Act
      const result = generator.generate(graph, registry);

      // Assert
      if (isErr(result)) {
        throw new Error('Expected successful generation');
      }

      expect(result).not.toContain("'guards':");
    });

    it('should serialize guards alongside middlewares and exceptionFilters when all are present', () => {
      // Arrange
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
          adapters: [
            {
              adapter: { __zipbul_ref: 'HttpAdapter', __zipbul_import_source: '@zipbul/http-adapter' },
              name: 'http',
              middlewares: [
                { __zipbul_ref: 'LogMiddleware', __zipbul_import_source: '/app/src/middlewares/log.ts' },
              ],
              exceptionFilters: [
                { __zipbul_ref: 'HttpExceptionFilter', __zipbul_import_source: '/app/src/filters/http-exception.ts' },
              ],
              guards: [
                { __zipbul_ref: 'AuthGuard', __zipbul_import_source: '/app/src/guards/auth-guard.ts' },
              ],
            },
          ],
        },
      });

      const graph = new ModuleGraph(fileMap, '__module__.ts');

      graph.build();

      const registry = new ImportRegistry('/app/src');
      const generator = new InjectorGenerator();

      // Act
      const result = generator.generate(graph, registry);

      // Assert
      if (isErr(result)) {
        throw new Error('Expected successful generation');
      }

      expect(result).toContain("'middlewares':");
      expect(result).toContain("'exceptionFilters':");
      expect(result).toContain("'guards':");
    });

    it('should merge adapter config across modules for the same adapter key', () => {
      const appModulePath = '/app/src/app/__module__.ts';
      const featureModulePath = '/app/src/feature/__module__.ts';
      const fileMap = new Map<string, FileAnalysis>();

      fileMap.set(appModulePath, {
        filePath: appModulePath,
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
          adapters: [
            {
              adapter: { __zipbul_ref: 'HttpAdapter', __zipbul_import_source: '@zipbul/http-adapter' },
              middlewares: {
                OnRequest: [
                  { __zipbul_ref: 'AppMiddleware', __zipbul_import_source: '/app/src/middlewares/app.ts' },
                ],
              },
              guards: [
                { __zipbul_ref: 'AppGuard', __zipbul_import_source: '/app/src/guards/app.ts' },
              ],
            },
          ],
        },
      });

      fileMap.set(featureModulePath, {
        filePath: featureModulePath,
        classes: [],
        reExports: [],
        exports: [],
        defineModuleCalls: [
          {
            callee: 'defineModule',
            importSource: '@zipbul/core',
            args: [],
            exportedName: 'featureModule',
          },
        ],
        imports: {},
        moduleDefinition: {
          name: 'FeatureModule',
          providers: [],
          imports: {},
          adapters: [
            {
              adapter: { __zipbul_ref: 'HttpAdapter', __zipbul_import_source: '@zipbul/http-adapter' },
              middlewares: {
                OnRequest: [
                  { __zipbul_ref: 'FeatureMiddleware', __zipbul_import_source: '/app/src/middlewares/feature.ts' },
                ],
                BeforeHandle: [
                  { __zipbul_ref: 'BeforeHandleMiddleware', __zipbul_import_source: '/app/src/middlewares/before-handle.ts' },
                ],
              },
              exceptionFilters: [
                { __zipbul_ref: 'FeatureFilter', __zipbul_import_source: '/app/src/filters/feature.ts' },
              ],
            },
          ],
        },
      });

      const graph = new ModuleGraph(fileMap, '__module__.ts');

      graph.build();

      const registry = new ImportRegistry('/app/src');
      const generator = new InjectorGenerator();
      const result = generator.generate(graph, registry);

      if (isErr(result)) {
        throw new Error('Expected successful generation');
      }

      expect(result.match(/'HttpAdapter': \{/g)?.length ?? 0).toBe(1);
      expect(result).toContain("'OnRequest': [AppMiddleware, FeatureMiddleware]");
      expect(result).toContain("'BeforeHandle': [BeforeHandleMiddleware]");
      expect(result).toContain("'guards': [AppGuard]");
      expect(result).toContain("'exceptionFilters': [FeatureFilter]");
    });
  });

  describe('AOT validation', () => {
    it('should throw when useClass references a class not found in classDefinitions (A-3)', () => {
      // Arrange
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
          providers: [
            {
              provide: 'SomeToken',
              useClass: { __zipbul_ref: 'NonExistentClass', __zipbul_import_source: '/app/src/app/non-existent.ts' },
            },
          ],
          imports: {},
        },
      });

      const graph = new ModuleGraph(fileMap, '__module__.ts');

      graph.build();

      const registry = new ImportRegistry('/app/src');
      const generator = new InjectorGenerator();

      // Act & Assert
      expect(() => generator.generate(graph, registry)).toThrow(
        'not found in any module',
      );
    });

    it('should throw when useFactory code string is empty (A-6)', () => {
      // Arrange
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
          providers: [
            {
              provide: 'ConfigToken',
              useFactory: {
                __zipbul_factory_code: '',
              },
            },
          ],
          imports: {},
        },
      });

      const graph = new ModuleGraph(fileMap, '__module__.ts');

      graph.build();

      const registry = new ImportRegistry('/app/src');
      const generator = new InjectorGenerator();

      // Act & Assert
      expect(() => generator.generate(graph, registry)).toThrow(
        'could not be extracted',
      );
    });

    it('should throw when useFactory inject list contains unresolvable token (A-8)', () => {
      // Arrange
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
          providers: [
            {
              provide: 'ConfigToken',
              useFactory: {
                __zipbul_factory_code: '() => 42',
              },
              inject: [{ notARef: true }],
            },
          ],
          imports: {},
        },
      });

      const graph = new ModuleGraph(fileMap, '__module__.ts');

      graph.build();

      const registry = new ImportRegistry('/app/src');
      const generator = new InjectorGenerator();

      // Act & Assert
      expect(() => generator.generate(graph, registry)).toThrow(
        'could not be resolved',
      );
    });


    it('should throw when useExisting target class is not registered (A-4)', () => {
      // Arrange
      const modulePath = '/app/src/app/__module__.ts';
      const depPath = '/app/src/app/unregistered-target.ts';
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
          providers: [
            {
              provide: 'AliasToken',
              useExisting: { __zipbul_ref: 'UnregisteredTarget', __zipbul_import_source: '/app/src/app/unregistered-target.ts' },
            },
          ],
          imports: {},
        },
      });

      fileMap.set(depPath, {
        filePath: depPath,
        classes: [
          {
            className: 'UnregisteredTarget',
            decorators: [],
            methods: [],
            properties: [],
            imports: {},
          },
        ],
        reExports: [],
        exports: ['UnregisteredTarget'],
        imports: {},
      });

      const graph = new ModuleGraph(fileMap, '__module__.ts');

      graph.build();

      const registry = new ImportRegistry('/app/src');
      const generator = new InjectorGenerator();

      // Act & Assert
      expect(() => generator.generate(graph, registry)).toThrow(
        'is not registered in any module',
      );
    });

    it('should throw when useFactory inject list references unregistered class (A-5)', () => {
      // Arrange
      const modulePath = '/app/src/app/__module__.ts';
      const depPath = '/app/src/app/unregistered-dep.ts';
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
          providers: [
            {
              provide: 'ConfigToken',
              useFactory: {
                __zipbul_factory_code: '(dep) => dep.getValue()',
              },
              inject: [{ __zipbul_ref: 'UnregisteredDep', __zipbul_import_source: '/app/src/app/unregistered-dep.ts' }],
            },
          ],
          imports: {},
        },
      });

      fileMap.set(depPath, {
        filePath: depPath,
        classes: [
          {
            className: 'UnregisteredDep',
            decorators: [],
            methods: [],
            properties: [],
            imports: {},
          },
        ],
        reExports: [],
        exports: ['UnregisteredDep'],
        imports: {},
      });

      const graph = new ModuleGraph(fileMap, '__module__.ts');

      graph.build();

      const registry = new ImportRegistry('/app/src');
      const generator = new InjectorGenerator();

      // Act & Assert
      expect(() => generator.generate(graph, registry)).toThrow(
        'is not registered in any module',
      );
    });
  });

  describe('class provider instantiation', () => {
    it('should emit `new <Class>()` with no constructor arguments for a useClass provider (inject()-only DI)', () => {
      // Arrange
      const modulePath = '/app/src/app/__module__.ts';
      const classPath = '/app/src/app/some.service.ts';
      const fileMap = new Map<string, FileAnalysis>();

      fileMap.set(modulePath, {
        filePath: modulePath,
        classes: [],
        reExports: [],
        exports: [],
        defineModuleCalls: [
          { callee: 'defineModule', importSource: '@zipbul/core', args: [], exportedName: 'appModule' },
        ],
        imports: {},
        moduleDefinition: {
          name: 'AppModule',
          providers: [
            { provide: 'SomeToken', useClass: { __zipbul_ref: 'SomeService', __zipbul_import_source: classPath } },
          ],
          imports: {},
        },
      });
      fileMap.set(classPath, {
        filePath: classPath,
        classes: [createInjectableClassMetadata('SomeService')],
        reExports: [],
        exports: [],
        imports: {},
      });

      const graph = new ModuleGraph(fileMap, '__module__.ts');

      graph.build();

      const registry = new ImportRegistry('/app/src');
      const generator = new InjectorGenerator();

      // Act
      const result = unwrapOk(generator.generate(graph, registry));

      // Assert: the provider class is instantiated with no constructor args —
      // DI flows through inject(), never constructor parameters.
      expect(result).toMatch(/new SomeService\w*\(\)/);
      // Regression guard: must never re-introduce constructor-injected args.
      expect(result).not.toMatch(/new SomeService\w*\([^)]/);
    });
  });
});
