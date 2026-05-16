import { describe, expect, it } from 'bun:test';

import type { Gildash, HeritageNode, FullSymbol, SymbolSearchResult, Implementation } from '@zipbul/gildash';

import type { ClassMetadata } from '../interfaces';
import type { ClassDefinition, ProviderRef } from './interfaces';
import type { ModuleNode } from './module-node';

import { ZIPBUL_REF } from '@zipbul/common';

import {
  validateVisibilityAndScope,
  validateProviderImplementations,
  validateProviderTypeCompatibility,
  validateFactoryParamTypes,
  validateModuleNameUniqueness,
  validateFactoryInjectTokens,
  validateInheritedScopes,
  validateUnusedProviders,
} from './module-validation-engine';

function createClassMetadata(className: string, constructorTokens?: string[]): ClassMetadata {
  return {
    className,
    heritage: undefined,
    decorators: [],
    constructorParams: (constructorTokens ?? []).map((token, index) => ({
      name: `p${index}`,
      type: { __zipbul_ref: token },
      decorators: [],
    })),
    methods: [],
    properties: [],
    imports: {},
  };
}

function createModuleNode(params: {
  name: string;
  filePath: string;
  providers?: Map<string, ProviderRef>;
  controllers?: Set<string>;
  exports?: Set<string>;
}): ModuleNode {
  const metadata = createClassMetadata(params.name);

  return {
    name: params.name,
    metadata,
    filePath: params.filePath,
    imports: new Set(),
    dynamicImports: new Set(),
    providers: params.providers ?? new Map(),
    exports: params.exports ?? new Set(),
    controllers: params.controllers ?? new Set(),
    visiting: false,
    visited: false,
  } as ModuleNode;
}

function createProviderRef(params: {
  token: string;
  visibility?: 'module' | 'all' | 'allowlist';
  visibleTo?: string[];
  scope?: 'singleton' | 'request' | 'transient';
  metadata?: ProviderRef['metadata'];
  filePath?: string;
}): ProviderRef {
  const ref: ProviderRef = {
    token: params.token,
    visibility: params.visibility ?? 'all',
  };

  if (params.visibleTo !== undefined) {
    ref.visibleTo = params.visibleTo;
  }

  if (params.scope !== undefined) {
    ref.scope = params.scope;
  }

  if (params.metadata !== undefined) {
    ref.metadata = params.metadata;
  }

  if (params.filePath !== undefined) {
    ref.filePath = params.filePath;
  }

  return ref;
}

interface MockGildashOptions {
  searchSymbolsResult?: SymbolSearchResult[];
  searchSymbolsThrows?: boolean;
  getFullSymbolResult?: FullSymbol | null;
  getImplementationsResult?: Implementation[];
  isTypeAssignableToResult?: boolean | null;
  isTypeAssignableToThrows?: boolean;
  getHeritageChainResult?: HeritageNode;
  getHeritageChainThrows?: boolean;
}

function createMockGildash(options?: MockGildashOptions): Gildash {
  const opts = options ?? {};

  return {
    searchSymbols: opts.searchSymbolsThrows
      ? () => { throw new Error('searchSymbols failed'); }
      : () => opts.searchSymbolsResult ?? [],
    getFullSymbol: () => opts.getFullSymbolResult ?? null,
    getImplementations: () => opts.getImplementationsResult ?? [],
    isTypeAssignableTo: opts.isTypeAssignableToThrows
      ? () => { throw new Error('isTypeAssignableTo failed'); }
      : () => opts.isTypeAssignableToResult ?? true,
    getHeritageChain: opts.getHeritageChainThrows
      ? () => Promise.reject(new Error('getHeritageChain failed'))
      : () => Promise.resolve(opts.getHeritageChainResult ?? { symbolName: 'Root', filePath: '', children: [] }),
  } as unknown as Gildash;
}

describe('validateVisibilityAndScope', () => {
  it('should pass with valid configuration and no scope violations', () => {
    const providerA = createProviderRef({
      token: 'ServiceA',
      scope: 'singleton',
      metadata: createClassMetadata('ServiceA', ['ServiceB']),
    });
    const providerB = createProviderRef({
      token: 'ServiceB',
      scope: 'singleton',
      metadata: createClassMetadata('ServiceB'),
    });

    const nodeA = createModuleNode({
      name: 'ModuleA',
      filePath: '/app/src/a/__module__.ts',
      providers: new Map([['ServiceA', providerA], ['ServiceB', providerB]]),
    });

    const modules = new Map([
      [nodeA.filePath, nodeA],
    ]);
    const classMap = new Map<string, ModuleNode>([
      ['ServiceA', nodeA],
      ['ServiceB', nodeA],
    ]);
    const moduleInjectDeps = new Map<string, string[]>();
    const warnings: string[] = [];

    expect(() => {
      validateVisibilityAndScope(modules, classMap, moduleInjectDeps, undefined, warnings);
    }).not.toThrow();
    expect(warnings).toHaveLength(0);
  });

  it('should throw when singleton injects request-scoped provider', () => {
    const singletonProvider = createProviderRef({
      token: 'SingletonService',
      scope: 'singleton',
      metadata: createClassMetadata('SingletonService', ['RequestService']),
    });
    const requestProvider = createProviderRef({
      token: 'RequestService',
      scope: 'request',
      metadata: createClassMetadata('RequestService'),
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([
        ['SingletonService', singletonProvider],
        ['RequestService', requestProvider],
      ]),
    });

    const modules = new Map([[node.filePath, node]]);
    const classMap = new Map<string, ModuleNode>([
      ['SingletonService', node],
      ['RequestService', node],
    ]);
    const warnings: string[] = [];

    expect(() => {
      validateVisibilityAndScope(modules, classMap, new Map(), undefined, warnings);
    }).toThrow(/Scope Violation.*Singleton.*SingletonService.*Request-Scoped.*RequestService/);
  });

  it('should throw when module-only visibility is crossed', () => {
    const providerA = createProviderRef({
      token: 'ServiceA',
      scope: 'singleton',
      metadata: createClassMetadata('ServiceA', ['ServiceB']),
    });
    const providerB = createProviderRef({
      token: 'ServiceB',
      visibility: 'module',
      scope: 'singleton',
      metadata: createClassMetadata('ServiceB'),
    });

    const nodeA = createModuleNode({
      name: 'ModuleA',
      filePath: '/app/src/a/__module__.ts',
      providers: new Map([['ServiceA', providerA]]),
    });
    const nodeB = createModuleNode({
      name: 'ModuleB',
      filePath: '/app/src/b/__module__.ts',
      providers: new Map([['ServiceB', providerB]]),
    });

    const modules = new Map([
      [nodeA.filePath, nodeA],
      [nodeB.filePath, nodeB],
    ]);
    const classMap = new Map<string, ModuleNode>([
      ['ServiceA', nodeA],
      ['ServiceB', nodeB],
    ]);
    const warnings: string[] = [];

    expect(() => {
      validateVisibilityAndScope(modules, classMap, new Map(), undefined, warnings);
    }).toThrow(/Visibility Violation.*ServiceA.*ModuleA.*ServiceB.*ModuleB.*module-only/);
  });

  it('should throw when allowlist visibility does not include consumer module', () => {
    const providerA = createProviderRef({
      token: 'ServiceA',
      scope: 'singleton',
      metadata: createClassMetadata('ServiceA', ['ServiceB']),
    });
    const providerB = createProviderRef({
      token: 'ServiceB',
      visibility: 'allowlist',
      visibleTo: ['OtherModule'],
      scope: 'singleton',
      metadata: createClassMetadata('ServiceB'),
    });

    const nodeA = createModuleNode({
      name: 'ModuleA',
      filePath: '/app/src/a/__module__.ts',
      providers: new Map([['ServiceA', providerA]]),
    });
    const nodeB = createModuleNode({
      name: 'ModuleB',
      filePath: '/app/src/b/__module__.ts',
      providers: new Map([['ServiceB', providerB]]),
    });

    const modules = new Map([
      [nodeA.filePath, nodeA],
      [nodeB.filePath, nodeB],
    ]);
    const classMap = new Map<string, ModuleNode>([
      ['ServiceA', nodeA],
      ['ServiceB', nodeB],
    ]);
    const warnings: string[] = [];

    expect(() => {
      validateVisibilityAndScope(modules, classMap, new Map(), undefined, warnings);
    }).toThrow(/Visibility Violation.*ServiceA.*ModuleA.*ServiceB.*ModuleB.*not allowlisted/);
  });

  it('should pass when allowlist includes the consumer module', () => {
    const providerA = createProviderRef({
      token: 'ServiceA',
      scope: 'singleton',
      metadata: createClassMetadata('ServiceA', ['ServiceB']),
    });
    const providerB = createProviderRef({
      token: 'ServiceB',
      visibility: 'allowlist',
      visibleTo: ['ModuleA'],
      scope: 'singleton',
      metadata: createClassMetadata('ServiceB'),
    });

    const nodeA = createModuleNode({
      name: 'ModuleA',
      filePath: '/app/src/a/__module__.ts',
      providers: new Map([['ServiceA', providerA]]),
    });
    const nodeB = createModuleNode({
      name: 'ModuleB',
      filePath: '/app/src/b/__module__.ts',
      providers: new Map([['ServiceB', providerB]]),
    });

    const modules = new Map([
      [nodeA.filePath, nodeA],
      [nodeB.filePath, nodeB],
    ]);
    const classMap = new Map<string, ModuleNode>([
      ['ServiceA', nodeA],
      ['ServiceB', nodeB],
    ]);
    const warnings: string[] = [];

    expect(() => {
      validateVisibilityAndScope(modules, classMap, new Map(), undefined, warnings);
    }).not.toThrow();
  });

  it('should skip providers with no metadata', () => {
    const providerNoMeta = createProviderRef({ token: 'NoMetaService' });
    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['NoMetaService', providerNoMeta]]),
    });

    const modules = new Map([[node.filePath, node]]);
    const classMap = new Map<string, ModuleNode>();
    const warnings: string[] = [];

    expect(() => {
      validateVisibilityAndScope(modules, classMap, new Map(), undefined, warnings);
    }).not.toThrow();
  });

  it('should validate inject deps from moduleInjectDeps', () => {
    const providerB = createProviderRef({
      token: 'ServiceB',
      visibility: 'module',
      metadata: createClassMetadata('ServiceB'),
    });

    const nodeA = createModuleNode({
      name: 'ModuleA',
      filePath: '/app/src/a/__module__.ts',
    });
    const nodeB = createModuleNode({
      name: 'ModuleB',
      filePath: '/app/src/b/__module__.ts',
      providers: new Map([['ServiceB', providerB]]),
    });

    const modules = new Map([
      [nodeA.filePath, nodeA],
      [nodeB.filePath, nodeB],
    ]);
    const classMap = new Map<string, ModuleNode>([
      ['ServiceB', nodeB],
    ]);
    const moduleInjectDeps = new Map([
      [nodeA.filePath, ['ServiceB']],
    ]);
    const warnings: string[] = [];

    expect(() => {
      validateVisibilityAndScope(modules, classMap, moduleInjectDeps, undefined, warnings);
    }).toThrow(/Visibility Violation/);
  });

  it('should handle empty modules map', () => {
    const modules = new Map<string, ModuleNode>();
    const classMap = new Map<string, ModuleNode>();
    const warnings: string[] = [];

    expect(() => {
      validateVisibilityAndScope(modules, classMap, new Map(), undefined, warnings);
    }).not.toThrow();
  });

  it('should allow request-scoped injecting request-scoped', () => {
    const providerA = createProviderRef({
      token: 'RequestA',
      scope: 'request',
      metadata: createClassMetadata('RequestA', ['RequestB']),
    });
    const providerB = createProviderRef({
      token: 'RequestB',
      scope: 'request',
      metadata: createClassMetadata('RequestB'),
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([
        ['RequestA', providerA],
        ['RequestB', providerB],
      ]),
    });

    const modules = new Map([[node.filePath, node]]);
    const classMap = new Map<string, ModuleNode>([
      ['RequestA', node],
      ['RequestB', node],
    ]);
    const warnings: string[] = [];

    expect(() => {
      validateVisibilityAndScope(modules, classMap, new Map(), undefined, warnings);
    }).not.toThrow();
  });

  it('should skip scope check when target provider is not found in classMap', () => {
    const providerA = createProviderRef({
      token: 'ServiceA',
      scope: 'singleton',
      metadata: createClassMetadata('ServiceA', ['ExternalDep']),
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['ServiceA', providerA]]),
    });

    const modules = new Map([[node.filePath, node]]);
    const classMap = new Map<string, ModuleNode>([['ServiceA', node]]);
    const warnings: string[] = [];

    expect(() => {
      validateVisibilityAndScope(modules, classMap, new Map(), undefined, warnings);
    }).not.toThrow();
  });
});

describe('validateProviderImplementations', () => {
  it('should pass when no interface tokens match', () => {
    const gildash = createMockGildash({ searchSymbolsResult: [] });
    const provider = createProviderRef({
      token: 'ConcreteService',
      metadata: createClassMetadata('ConcreteService'),
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['ConcreteService', provider]]),
    });

    const modules = new Map([[node.filePath, node]]);
    const classDefinitions = new Map<string, ClassDefinition>();
    const warnings: string[] = [];

    validateProviderImplementations(modules, classDefinitions, gildash, warnings);
    expect(warnings).toHaveLength(0);
  });

  it('should warn when provider class does not implement its token interface', () => {
    const interfaceToken = 'UserRepository';
    const gildash = createMockGildash({
      searchSymbolsResult: [
        { name: interfaceToken, kind: 'interface', filePath: '/app/src/repo.ts' } as SymbolSearchResult,
      ],
      getFullSymbolResult: { name: interfaceToken, kind: 'interface', filePath: '/app/src/repo.ts' } as FullSymbol,
      getImplementationsResult: [
        { symbolName: 'SqlUserRepository', filePath: '/app/src/sql-repo.ts' } as Implementation,
      ],
    });

    const classMetadata = createClassMetadata('WrongImpl');
    const provider = createProviderRef({
      token: interfaceToken,
      filePath: '/app/src/repo.ts',
      metadata: classMetadata,
    });

    const node = createModuleNode({
      name: 'RepoModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([[interfaceToken, provider]]),
    });

    const modules = new Map([[node.filePath, node]]);
    const classDefinitions = new Map<string, ClassDefinition>();
    const warnings: string[] = [];

    validateProviderImplementations(modules, classDefinitions, gildash, warnings);
    expect(warnings.some(w => w.includes('WrongImpl') && w.includes('does not implement'))).toBe(true);
  });

  it('should not warn when searchSymbols throws', () => {
    const gildash = createMockGildash({ searchSymbolsThrows: true });
    const provider = createProviderRef({
      token: 'SomeInterface',
      metadata: createClassMetadata('SomeImpl'),
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['SomeInterface', provider]]),
    });

    const modules = new Map([[node.filePath, node]]);
    const warnings: string[] = [];

    validateProviderImplementations(modules, new Map(), gildash, warnings);
    expect(warnings).toHaveLength(0);
  });

  it('should add warning when getFullSymbol throws', () => {
    const gildash = createMockGildash({
      searchSymbolsResult: [
        { name: 'MyInterface', kind: 'interface', filePath: '/app/src/iface.ts' } as SymbolSearchResult,
      ],
    });

    Object.defineProperty(gildash, 'getFullSymbol', {
      value: () => { throw new Error('resolution failed'); },
    });

    const provider = createProviderRef({
      token: 'MyInterface',
      filePath: '/app/src/iface.ts',
      metadata: createClassMetadata('MyImpl'),
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['MyInterface', provider]]),
    });

    const modules = new Map([[node.filePath, node]]);
    const warnings: string[] = [];

    validateProviderImplementations(modules, new Map(), gildash, warnings);
    expect(warnings.some(w => w.includes('Symbol resolution failed'))).toBe(true);
  });

  it('should skip when provider token is not an interface', () => {
    const gildash = createMockGildash({
      searchSymbolsResult: [
        { name: 'SomeClass', kind: 'class', filePath: '/app/src/cls.ts' } as SymbolSearchResult,
      ],
    });

    const provider = createProviderRef({
      token: 'ConcreteService',
      metadata: createClassMetadata('ConcreteService'),
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['ConcreteService', provider]]),
    });

    const modules = new Map([[node.filePath, node]]);
    const warnings: string[] = [];

    validateProviderImplementations(modules, new Map(), gildash, warnings);
    expect(warnings).toHaveLength(0);
  });

  it('should skip when filePath is not available for the provider', () => {
    const gildash = createMockGildash({
      searchSymbolsResult: [
        { name: 'MyInterface', kind: 'interface', filePath: '/app/src/iface.ts' } as SymbolSearchResult,
      ],
    });

    const provider = createProviderRef({
      token: 'MyInterface',
      metadata: { provide: 'MyInterface', useClass: 'SomeClass' },
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['MyInterface', provider]]),
    });

    const modules = new Map([[node.filePath, node]]);
    const warnings: string[] = [];

    validateProviderImplementations(modules, new Map(), gildash, warnings);
    expect(warnings).toHaveLength(0);
  });

  it('should handle empty modules', () => {
    const gildash = createMockGildash();
    const warnings: string[] = [];

    validateProviderImplementations(new Map(), new Map(), gildash, warnings);
    expect(warnings).toHaveLength(0);
  });
});

describe('validateProviderTypeCompatibility', () => {
  it('should pass when useClass is type-compatible', () => {
    const gildash = createMockGildash({ isTypeAssignableToResult: true });
    const provider = createProviderRef({
      token: 'IService',
      filePath: '/app/src/iface.ts',
      metadata: { provide: 'IService', useClass: 'ServiceImpl' },
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['IService', provider]]),
    });

    const classDefinitions = new Map<string, ClassDefinition>([
      ['IService', { metadata: createClassMetadata('IService'), filePath: '/app/src/iface.ts' }],
      ['ServiceImpl', { metadata: createClassMetadata('ServiceImpl'), filePath: '/app/src/impl.ts' }],
    ]);
    const warnings: string[] = [];

    validateProviderTypeCompatibility(new Map([[node.filePath, node]]), classDefinitions, gildash, warnings);
    expect(warnings).toHaveLength(0);
  });

  it('should warn when useClass is not assignable to token', () => {
    const gildash = createMockGildash({ isTypeAssignableToResult: false });
    const provider = createProviderRef({
      token: 'IService',
      filePath: '/app/src/iface.ts',
      metadata: { provide: 'IService', useClass: 'WrongImpl' },
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['IService', provider]]),
    });

    const classDefinitions = new Map<string, ClassDefinition>([
      ['IService', { metadata: createClassMetadata('IService'), filePath: '/app/src/iface.ts' }],
      ['WrongImpl', { metadata: createClassMetadata('WrongImpl'), filePath: '/app/src/wrong.ts' }],
    ]);
    const warnings: string[] = [];

    validateProviderTypeCompatibility(new Map([[node.filePath, node]]), classDefinitions, gildash, warnings);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("'WrongImpl'");
    expect(warnings[0]).toContain("not assignable to 'IService'");
  });

  it('should warn when useExisting is not assignable to token', () => {
    const gildash = createMockGildash({ isTypeAssignableToResult: false });
    const provider = createProviderRef({
      token: 'IService',
      filePath: '/app/src/iface.ts',
      metadata: { provide: 'IService', useExisting: 'OtherService' },
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['IService', provider]]),
    });

    const classDefinitions = new Map<string, ClassDefinition>([
      ['IService', { metadata: createClassMetadata('IService'), filePath: '/app/src/iface.ts' }],
      ['OtherService', { metadata: createClassMetadata('OtherService'), filePath: '/app/src/other.ts' }],
    ]);
    const warnings: string[] = [];

    validateProviderTypeCompatibility(new Map([[node.filePath, node]]), classDefinitions, gildash, warnings);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("'OtherService'");
    expect(warnings[0]).toContain("not assignable to 'IService'");
  });

  it('should skip when metadata is not a record', () => {
    const gildash = createMockGildash();
    const provider = createProviderRef({
      token: 'Service',
      metadata: createClassMetadata('Service'),
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['Service', provider]]),
    });

    const warnings: string[] = [];

    validateProviderTypeCompatibility(new Map([[node.filePath, node]]), new Map(), gildash, warnings);
    expect(warnings).toHaveLength(0);
  });

  it('should skip when file paths are missing for token or impl', () => {
    const gildash = createMockGildash({ isTypeAssignableToResult: false });
    const provider = createProviderRef({
      token: 'IService',
      metadata: { provide: 'IService', useClass: 'MissingImpl' },
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['IService', provider]]),
    });

    const warnings: string[] = [];

    validateProviderTypeCompatibility(new Map([[node.filePath, node]]), new Map(), gildash, warnings);
    expect(warnings).toHaveLength(0);
  });

  it('should silently skip when isTypeAssignableTo throws', () => {
    const gildash = createMockGildash({ isTypeAssignableToThrows: true });
    const provider = createProviderRef({
      token: 'IService',
      filePath: '/app/src/iface.ts',
      metadata: { provide: 'IService', useClass: 'ServiceImpl' },
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['IService', provider]]),
    });

    const classDefinitions = new Map<string, ClassDefinition>([
      ['IService', { metadata: createClassMetadata('IService'), filePath: '/app/src/iface.ts' }],
      ['ServiceImpl', { metadata: createClassMetadata('ServiceImpl'), filePath: '/app/src/impl.ts' }],
    ]);
    const warnings: string[] = [];

    validateProviderTypeCompatibility(new Map([[node.filePath, node]]), classDefinitions, gildash, warnings);
    expect(warnings).toHaveLength(0);
  });

  it('should resolve useClass from ZIPBUL_REF record', () => {
    const gildash = createMockGildash({ isTypeAssignableToResult: false });
    const provider = createProviderRef({
      token: 'IService',
      filePath: '/app/src/iface.ts',
      metadata: {
        provide: 'IService',
        useClass: { [ZIPBUL_REF]: 'RefImpl' },
      },
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['IService', provider]]),
    });

    const classDefinitions = new Map<string, ClassDefinition>([
      ['IService', { metadata: createClassMetadata('IService'), filePath: '/app/src/iface.ts' }],
      ['RefImpl', { metadata: createClassMetadata('RefImpl'), filePath: '/app/src/ref-impl.ts' }],
    ]);
    const warnings: string[] = [];

    validateProviderTypeCompatibility(new Map([[node.filePath, node]]), classDefinitions, gildash, warnings);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("'RefImpl'");
  });

  it('should resolve useExisting from ZIPBUL_REF record', () => {
    const gildash = createMockGildash({ isTypeAssignableToResult: false });
    const provider = createProviderRef({
      token: 'IService',
      filePath: '/app/src/iface.ts',
      metadata: {
        provide: 'IService',
        useExisting: { [ZIPBUL_REF]: 'ExistingRef' },
      },
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['IService', provider]]),
    });

    const classDefinitions = new Map<string, ClassDefinition>([
      ['IService', { metadata: createClassMetadata('IService'), filePath: '/app/src/iface.ts' }],
      ['ExistingRef', { metadata: createClassMetadata('ExistingRef'), filePath: '/app/src/existing.ts' }],
    ]);
    const warnings: string[] = [];

    validateProviderTypeCompatibility(new Map([[node.filePath, node]]), classDefinitions, gildash, warnings);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("'ExistingRef'");
  });

  it('should handle empty modules', () => {
    const gildash = createMockGildash();
    const warnings: string[] = [];

    validateProviderTypeCompatibility(new Map(), new Map(), gildash, warnings);
    expect(warnings).toHaveLength(0);
  });
});

describe('validateFactoryParamTypes', () => {
  it('should pass when factory inject types are compatible with params', () => {
    const gildash = createMockGildash({ isTypeAssignableToResult: true });
    const provider = createProviderRef({
      token: 'FactoryService',
      metadata: {
        provide: 'FactoryService',
        useFactory: {
          __zipbul_factory_injects: [
            { token: 'DepService', tokenKind: 'token' },
          ],
          __zipbul_factory_params: [
            { typeName: 'DepService', importSource: '/app/src/dep.ts' },
          ],
        },
      },
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['FactoryService', provider]]),
    });

    const classDefinitions = new Map<string, ClassDefinition>([
      ['DepService', { metadata: createClassMetadata('DepService'), filePath: '/app/src/dep.ts' }],
    ]);
    const warnings: string[] = [];

    validateFactoryParamTypes(new Map([[node.filePath, node]]), classDefinitions, gildash, warnings);
    expect(warnings).toHaveLength(0);
  });

  it('should warn when factory inject type is not assignable to param type', () => {
    const gildash = createMockGildash({ isTypeAssignableToResult: false });
    const provider = createProviderRef({
      token: 'FactoryService',
      metadata: {
        provide: 'FactoryService',
        useFactory: {
          __zipbul_factory_injects: [
            { token: 'WrongDep', tokenKind: 'token' },
          ],
          __zipbul_factory_params: [
            { typeName: 'ExpectedDep', importSource: '/app/src/expected.ts' },
          ],
        },
      },
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['FactoryService', provider]]),
    });

    const classDefinitions = new Map<string, ClassDefinition>([
      ['WrongDep', { metadata: createClassMetadata('WrongDep'), filePath: '/app/src/wrong.ts' }],
      ['ExpectedDep', { metadata: createClassMetadata('ExpectedDep'), filePath: '/app/src/expected.ts' }],
    ]);
    const warnings: string[] = [];

    validateFactoryParamTypes(new Map([[node.filePath, node]]), classDefinitions, gildash, warnings);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("inject[0] 'WrongDep'");
    expect(warnings[0]).toContain("not assignable to parameter type 'ExpectedDep'");
  });

  it('should skip when no useFactory is defined', () => {
    const gildash = createMockGildash();
    const provider = createProviderRef({
      token: 'Service',
      metadata: { provide: 'Service', useClass: 'ServiceImpl' },
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['Service', provider]]),
    });

    const warnings: string[] = [];

    validateFactoryParamTypes(new Map([[node.filePath, node]]), new Map(), gildash, warnings);
    expect(warnings).toHaveLength(0);
  });

  it('should skip when factory injects or params are empty', () => {
    const gildash = createMockGildash();
    const provider = createProviderRef({
      token: 'FactoryService',
      metadata: {
        provide: 'FactoryService',
        useFactory: {
          __zipbul_factory_injects: [],
          __zipbul_factory_params: [],
        },
      },
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['FactoryService', provider]]),
    });

    const warnings: string[] = [];

    validateFactoryParamTypes(new Map([[node.filePath, node]]), new Map(), gildash, warnings);
    expect(warnings).toHaveLength(0);
  });

  it('should skip when inject def or param def is missing', () => {
    const gildash = createMockGildash({ isTypeAssignableToResult: false });
    const provider = createProviderRef({
      token: 'FactoryService',
      metadata: {
        provide: 'FactoryService',
        useFactory: {
          __zipbul_factory_injects: [
            { token: 'UnknownDep', tokenKind: 'token' },
          ],
          __zipbul_factory_params: [
            { typeName: 'UnknownParam' },
          ],
        },
      },
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['FactoryService', provider]]),
    });

    const warnings: string[] = [];

    validateFactoryParamTypes(new Map([[node.filePath, node]]), new Map(), gildash, warnings);
    expect(warnings).toHaveLength(0);
  });

  it('should silently skip when isTypeAssignableTo throws', () => {
    const gildash = createMockGildash({ isTypeAssignableToThrows: true });
    const provider = createProviderRef({
      token: 'FactoryService',
      metadata: {
        provide: 'FactoryService',
        useFactory: {
          __zipbul_factory_injects: [
            { token: 'DepService', tokenKind: 'token' },
          ],
          __zipbul_factory_params: [
            { typeName: 'DepService', importSource: '/app/src/dep.ts' },
          ],
        },
      },
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['FactoryService', provider]]),
    });

    const classDefinitions = new Map<string, ClassDefinition>([
      ['DepService', { metadata: createClassMetadata('DepService'), filePath: '/app/src/dep.ts' }],
    ]);
    const warnings: string[] = [];

    validateFactoryParamTypes(new Map([[node.filePath, node]]), classDefinitions, gildash, warnings);
    expect(warnings).toHaveLength(0);
  });

  it('should handle empty modules', () => {
    const gildash = createMockGildash();
    const warnings: string[] = [];

    validateFactoryParamTypes(new Map(), new Map(), gildash, warnings);
    expect(warnings).toHaveLength(0);
  });
});

describe('validateModuleNameUniqueness', () => {
  it('should pass when all module names are unique', () => {
    const nodeA = createModuleNode({
      name: 'ModuleA',
      filePath: '/app/src/a/__module__.ts',
    });
    const nodeB = createModuleNode({
      name: 'ModuleB',
      filePath: '/app/src/b/__module__.ts',
    });

    const modules = new Map([
      [nodeA.filePath, nodeA],
      [nodeB.filePath, nodeB],
    ]);

    expect(() => validateModuleNameUniqueness(modules)).not.toThrow();
  });

  it('should throw when duplicate module names exist', () => {
    const nodeA = createModuleNode({
      name: 'SharedName',
      filePath: '/app/src/a/__module__.ts',
    });
    const nodeB = createModuleNode({
      name: 'SharedName',
      filePath: '/app/src/b/__module__.ts',
    });

    const modules = new Map([
      [nodeA.filePath, nodeA],
      [nodeB.filePath, nodeB],
    ]);

    expect(() => validateModuleNameUniqueness(modules)).toThrow(/Duplicate module name 'SharedName'/);
  });

  it('should pass with empty modules map', () => {
    expect(() => validateModuleNameUniqueness(new Map())).not.toThrow();
  });

  it('should pass with single module', () => {
    const node = createModuleNode({
      name: 'OnlyModule',
      filePath: '/app/src/__module__.ts',
    });

    expect(() => validateModuleNameUniqueness(new Map([[node.filePath, node]]))).not.toThrow();
  });

  it('should include both file paths in error message', () => {
    const nodeA = createModuleNode({
      name: 'DupName',
      filePath: '/app/src/first/__module__.ts',
    });
    const nodeB = createModuleNode({
      name: 'DupName',
      filePath: '/app/src/second/__module__.ts',
    });

    const modules = new Map([
      [nodeA.filePath, nodeA],
      [nodeB.filePath, nodeB],
    ]);

    expect(() => validateModuleNameUniqueness(modules)).toThrow(/\/app\/src\/second\/__module__\.ts.*\/app\/src\/first\/__module__\.ts/);
  });
});

describe('validateFactoryInjectTokens', () => {
  it('should pass when all inject tokens are valid', () => {
    const provider = createProviderRef({
      token: 'FactoryService',
      metadata: {
        provide: 'FactoryService',
        useFactory: {
          __zipbul_factory_injects: [
            { token: 'ValidDep', tokenKind: 'token' },
          ],
        },
      },
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['FactoryService', provider]]),
    });

    expect(() => validateFactoryInjectTokens(new Map([[node.filePath, node]]))).not.toThrow();
  });

  it('should throw when inject token kind is invalid', () => {
    const provider = createProviderRef({
      token: 'FactoryService',
      metadata: {
        provide: 'FactoryService',
        useFactory: {
          __zipbul_factory_injects: [
            { token: null, tokenKind: 'invalid' },
          ],
        },
      },
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['FactoryService', provider]]),
    });

    expect(() => validateFactoryInjectTokens(new Map([[node.filePath, node]]))).toThrow(
      /inject\(\) token.*FactoryService.*TestModule.*not statically determinable/,
    );
  });

  it('should throw when inject token is null', () => {
    const provider = createProviderRef({
      token: 'FactoryService',
      metadata: {
        provide: 'FactoryService',
        useFactory: {
          __zipbul_factory_injects: [
            { token: null, tokenKind: 'token' },
          ],
        },
      },
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['FactoryService', provider]]),
    });

    expect(() => validateFactoryInjectTokens(new Map([[node.filePath, node]]))).toThrow(
      /inject\(\) token.*not statically determinable/,
    );
  });

  it('should pass when no useFactory is defined', () => {
    const provider = createProviderRef({
      token: 'Service',
      metadata: { provide: 'Service', useClass: 'Impl' },
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['Service', provider]]),
    });

    expect(() => validateFactoryInjectTokens(new Map([[node.filePath, node]]))).not.toThrow();
  });

  it('should pass when factory has no injects', () => {
    const provider = createProviderRef({
      token: 'FactoryService',
      metadata: {
        provide: 'FactoryService',
        useFactory: {},
      },
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['FactoryService', provider]]),
    });

    expect(() => validateFactoryInjectTokens(new Map([[node.filePath, node]]))).not.toThrow();
  });

  it('should handle empty modules', () => {
    expect(() => validateFactoryInjectTokens(new Map())).not.toThrow();
  });

  it('should skip inject entries that are not records', () => {
    const provider = createProviderRef({
      token: 'FactoryService',
      metadata: {
        provide: 'FactoryService',
        useFactory: {
          __zipbul_factory_injects: ['not-a-record', 42],
        },
      },
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['FactoryService', provider]]),
    });

    expect(() => validateFactoryInjectTokens(new Map([[node.filePath, node]]))).not.toThrow();
  });

  it('should skip providers with null metadata record', () => {
    const provider = createProviderRef({
      token: 'NoMetaService',
      metadata: 'string-metadata',
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['NoMetaService', provider]]),
    });

    expect(() => validateFactoryInjectTokens(new Map([[node.filePath, node]]))).not.toThrow();
  });
});

describe('validateInheritedScopes', () => {
  it('should pass when singleton has no heritage chain issues', async () => {
    const heritageChain: HeritageNode = {
      symbolName: 'ServiceA',
      filePath: '/app/src/a.ts',
      children: [],
    };
    const gildash = createMockGildash({ getHeritageChainResult: heritageChain });

    const provider = createProviderRef({
      token: 'ServiceA',
      scope: 'singleton',
      metadata: createClassMetadata('ServiceA'),
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['ServiceA', provider]]),
    });

    const classDefinitions = new Map<string, ClassDefinition>([
      ['ServiceA', { metadata: createClassMetadata('ServiceA'), filePath: '/app/src/a.ts' }],
    ]);
    const classMap = new Map<string, ModuleNode>([['ServiceA', node]]);
    const warnings: string[] = [];

    await validateInheritedScopes(
      new Map([[node.filePath, node]]),
      classDefinitions,
      classMap,
      gildash,
      warnings,
    );

    expect(warnings).toHaveLength(0);
  });

  it('should add warning when singleton inherits from request-scoped via heritage', async () => {
    const parentProvider = createProviderRef({
      token: 'ParentService',
      scope: 'request',
      metadata: createClassMetadata('ParentService'),
    });

    const childProvider = createProviderRef({
      token: 'ChildService',
      scope: 'singleton',
      metadata: createClassMetadata('ChildService'),
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([
        ['ChildService', childProvider],
        ['ParentService', parentProvider],
      ]),
    });

    const heritageChain: HeritageNode = {
      symbolName: 'ChildService',
      filePath: '/app/src/child.ts',
      children: [
        {
          symbolName: 'ParentService',
          filePath: '/app/src/parent.ts',
          kind: 'extends',
          children: [],
        },
      ],
    };
    const gildash = createMockGildash({ getHeritageChainResult: heritageChain });

    const classDefinitions = new Map<string, ClassDefinition>([
      ['ChildService', { metadata: createClassMetadata('ChildService'), filePath: '/app/src/child.ts' }],
      ['ParentService', { metadata: createClassMetadata('ParentService'), filePath: '/app/src/parent.ts' }],
    ]);
    const classMap = new Map<string, ModuleNode>([
      ['ChildService', node],
      ['ParentService', node],
    ]);

    const warnings: string[] = [];

    await validateInheritedScopes(
      new Map([[node.filePath, node]]),
      classDefinitions,
      classMap,
      gildash,
      warnings,
    );

    expect(warnings.some(w => w.includes('ChildService') && w.includes('Heritage chain resolution failed'))).toBe(true);
  });

  it('should skip non-singleton providers', async () => {
    const gildash = createMockGildash();
    const provider = createProviderRef({
      token: 'RequestService',
      scope: 'request',
      metadata: createClassMetadata('RequestService'),
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['RequestService', provider]]),
    });

    const classDefinitions = new Map<string, ClassDefinition>([
      ['RequestService', { metadata: createClassMetadata('RequestService'), filePath: '/app/src/req.ts' }],
    ]);
    const warnings: string[] = [];

    await validateInheritedScopes(
      new Map([[node.filePath, node]]),
      classDefinitions,
      new Map(),
      gildash,
      warnings,
    );

    expect(warnings).toHaveLength(0);
  });

  it('should skip when class definition is not found', async () => {
    const gildash = createMockGildash();
    const provider = createProviderRef({
      token: 'MissingDef',
      scope: 'singleton',
      metadata: createClassMetadata('MissingDef'),
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['MissingDef', provider]]),
    });

    const warnings: string[] = [];

    await validateInheritedScopes(
      new Map([[node.filePath, node]]),
      new Map(),
      new Map(),
      gildash,
      warnings,
    );

    expect(warnings).toHaveLength(0);
  });

  it('should add warning when getHeritageChain throws', async () => {
    const gildash = createMockGildash({ getHeritageChainThrows: true });
    const provider = createProviderRef({
      token: 'ServiceA',
      scope: 'singleton',
      metadata: createClassMetadata('ServiceA'),
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['ServiceA', provider]]),
    });

    const classDefinitions = new Map<string, ClassDefinition>([
      ['ServiceA', { metadata: createClassMetadata('ServiceA'), filePath: '/app/src/a.ts' }],
    ]);
    const warnings: string[] = [];

    await validateInheritedScopes(
      new Map([[node.filePath, node]]),
      classDefinitions,
      new Map(),
      gildash,
      warnings,
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Heritage chain resolution failed');
    expect(warnings[0]).toContain('ServiceA');
  });

  it('should handle empty modules', async () => {
    const gildash = createMockGildash();
    const warnings: string[] = [];

    await validateInheritedScopes(new Map(), new Map(), new Map(), gildash, warnings);
    expect(warnings).toHaveLength(0);
  });

  it('should treat provider with no explicit scope as singleton', async () => {
    const parentProvider = createProviderRef({
      token: 'ParentService',
      scope: 'request',
      metadata: createClassMetadata('ParentService'),
    });

    const childProvider = createProviderRef({
      token: 'ChildService',
      metadata: createClassMetadata('ChildService'),
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([
        ['ChildService', childProvider],
        ['ParentService', parentProvider],
      ]),
    });

    const heritageChain: HeritageNode = {
      symbolName: 'ChildService',
      filePath: '/app/src/child.ts',
      children: [
        {
          symbolName: 'ParentService',
          filePath: '/app/src/parent.ts',
          kind: 'extends',
          children: [],
        },
      ],
    };
    const gildash = createMockGildash({ getHeritageChainResult: heritageChain });

    const classDefinitions = new Map<string, ClassDefinition>([
      ['ChildService', { metadata: createClassMetadata('ChildService'), filePath: '/app/src/child.ts' }],
    ]);
    const classMap = new Map<string, ModuleNode>([
      ['ChildService', node],
      ['ParentService', node],
    ]);
    const warnings: string[] = [];

    await validateInheritedScopes(
      new Map([[node.filePath, node]]),
      classDefinitions,
      classMap,
      gildash,
      warnings,
    );

    expect(warnings.some(w => w.includes('ChildService') && w.includes('Heritage chain resolution failed'))).toBe(true);
  });
});

describe('validateUnusedProviders', () => {
  it('should warn when a provider is never referenced', () => {
    const unusedProvider = createProviderRef({
      token: 'UnusedService',
      metadata: createClassMetadata('UnusedService'),
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['UnusedService', unusedProvider]]),
    });

    const modules = new Map([[node.filePath, node]]);
    const classDefinitions = new Map<string, ClassDefinition>();
    const moduleInjectDeps = new Map<string, string[]>();
    const warnings: string[] = [];
    const extractDepsFromProvider = (): string[] => [];

    validateUnusedProviders(modules, classDefinitions, moduleInjectDeps, undefined, warnings, extractDepsFromProvider);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Provider 'UnusedService'");
    expect(warnings[0]).toContain('never referenced');
  });

  it('should not warn when provider is referenced by another provider', () => {
    const depProvider = createProviderRef({
      token: 'DepService',
      metadata: createClassMetadata('DepService'),
    });
    const consumerProvider = createProviderRef({
      token: 'ConsumerService',
      metadata: createClassMetadata('ConsumerService', ['DepService']),
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([
        ['DepService', depProvider],
        ['ConsumerService', consumerProvider],
      ]),
    });

    const modules = new Map([[node.filePath, node]]);
    const classDefinitions = new Map<string, ClassDefinition>();
    const moduleInjectDeps = new Map<string, string[]>();
    const warnings: string[] = [];
    const extractDepsFromProvider = (provider: ProviderRef): string[] => {
      if (provider.token === 'ConsumerService') {
        return ['DepService'];
      }

      return [];
    };

    validateUnusedProviders(modules, classDefinitions, moduleInjectDeps, undefined, warnings, extractDepsFromProvider);

    expect(warnings.some(w => w.includes('DepService') && w.includes('never referenced'))).toBe(false);
  });

  it('should not warn when provider is a controller', () => {
    const controllerProvider = createProviderRef({
      token: 'AppController',
      metadata: createClassMetadata('AppController'),
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['AppController', controllerProvider]]),
      controllers: new Set(['AppController']),
    });

    const modules = new Map([[node.filePath, node]]);
    const warnings: string[] = [];
    const extractDepsFromProvider = (): string[] => [];

    validateUnusedProviders(modules, new Map(), new Map(), undefined, warnings, extractDepsFromProvider);

    expect(warnings).toHaveLength(0);
  });

  it('should not warn when provider is referenced via moduleInjectDeps', () => {
    const provider = createProviderRef({
      token: 'InjectedService',
      metadata: createClassMetadata('InjectedService'),
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([['InjectedService', provider]]),
    });

    const modules = new Map([[node.filePath, node]]);
    const moduleInjectDeps = new Map([
      [node.filePath, ['InjectedService']],
    ]);
    const warnings: string[] = [];
    const extractDepsFromProvider = (): string[] => [];

    validateUnusedProviders(modules, new Map(), moduleInjectDeps, undefined, warnings, extractDepsFromProvider);

    expect(warnings).toHaveLength(0);
  });

  it('should handle empty modules', () => {
    const warnings: string[] = [];

    validateUnusedProviders(new Map(), new Map(), new Map(), undefined, warnings, () => []);

    expect(warnings).toHaveLength(0);
  });

  it('should handle module with no providers', () => {
    const node = createModuleNode({
      name: 'EmptyModule',
      filePath: '/app/src/__module__.ts',
    });

    const modules = new Map([[node.filePath, node]]);
    const warnings: string[] = [];

    validateUnusedProviders(modules, new Map(), new Map(), undefined, warnings, () => []);

    expect(warnings).toHaveLength(0);
  });

  it('should warn for multiple unused providers', () => {
    const unusedA = createProviderRef({
      token: 'UnusedA',
      metadata: createClassMetadata('UnusedA'),
    });
    const unusedB = createProviderRef({
      token: 'UnusedB',
      metadata: createClassMetadata('UnusedB'),
    });

    const node = createModuleNode({
      name: 'TestModule',
      filePath: '/app/src/__module__.ts',
      providers: new Map([
        ['UnusedA', unusedA],
        ['UnusedB', unusedB],
      ]),
    });

    const modules = new Map([[node.filePath, node]]);
    const warnings: string[] = [];

    validateUnusedProviders(modules, new Map(), new Map(), undefined, warnings, () => []);

    expect(warnings).toHaveLength(2);
    expect(warnings.some(w => w.includes('UnusedA'))).toBe(true);
    expect(warnings.some(w => w.includes('UnusedB'))).toBe(true);
  });
});
