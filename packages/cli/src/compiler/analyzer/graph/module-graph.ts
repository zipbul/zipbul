import { basename, dirname } from 'path';

import type { Gildash, HeritageNode } from '@zipbul/gildash';

import type { ClassMetadata } from '../interfaces';
import type { AnalyzerValue, AnalyzerValueRecord } from '../types';
import type { CyclePath, ProviderRef, FileAnalysis } from './interfaces';

import { compareCodePoint } from '../../../common';
import { ModuleDiscovery } from '../module-discovery';
import { ModuleNode } from './module-node';

type ProviderMetadata = AnalyzerValue | ClassMetadata;

interface VisibilityResolution {
  kind: 'module' | 'all' | 'allowlist';
  visibleTo?: string[];
}

interface InjectableOptions {
  visibility: 'module' | 'all' | 'allowlist';
  visibleTo?: string[];
  scope: 'singleton' | 'request' | 'transient';
}

interface ClassDefinition {
  metadata: ClassMetadata;
  filePath: string;
}

type ProviderTokenValue = AnalyzerValue | ClassMetadata | CallableFunction | symbol;

const isRecordValue = (value: ProviderTokenValue | ProviderMetadata): value is AnalyzerValueRecord => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const isAnalyzerValueArray = (value: AnalyzerValue): value is AnalyzerValue[] => {
  return Array.isArray(value);
};

const isNonEmptyString = (value: string | undefined): value is string => {
  return typeof value === 'string' && value.length > 0;
};

export class ModuleGraph {
  public modules: Map<string, ModuleNode> = new Map();
  public classMap: Map<string, ModuleNode> = new Map();
  public classDefinitions: Map<string, ClassDefinition> = new Map();
  public warnings: string[] = [];
  private moduleFileSet: Set<string> = new Set();
  private moduleNameByPath: Map<string, string> = new Map();
  private moduleMarkerExports: Map<string, Set<string>> = new Map();
  private moduleInjectDeps: Map<string, string[]> = new Map();
  constructor(
    private fileMap: Map<string, FileAnalysis>,
    private moduleFileName: string,
    private readonly gildash?: Gildash,
  ) {}

  build(): Map<string, ModuleNode> {
    const allFiles = Array.from(this.fileMap.keys()).sort(compareCodePoint);
    const discovery = new ModuleDiscovery(allFiles, this.moduleFileName);
    const moduleMap = discovery.discover();
    const orphans = discovery.getOrphans();

    this.moduleFileSet = new Set(moduleMap.keys());

    if (orphans.size > 0) {
      const sortedOrphans = Array.from(orphans.values()).sort(compareCodePoint);
      const summary = sortedOrphans.join('\n');

      throw new Error(`[Zipbul AOT] Orphan files detected:\n${summary}`);
    }

    const moduleEntries = Array.from(moduleMap.entries()).sort(([a], [b]) => compareCodePoint(a, b));

    this.moduleNameByPath = this.collectModuleNames(moduleEntries);
    this.moduleMarkerExports = this.collectModuleMarkerExports(moduleEntries);

    for (const [modulePath, files] of moduleEntries) {
      const moduleFile = this.fileMap.get(modulePath);
      const rawDef = moduleFile?.moduleDefinition;

      if (moduleFile) {
        const defineModuleCalls = moduleFile.defineModuleCalls ?? [];

        if (defineModuleCalls.length === 0) {
          throw new Error(`[Zipbul AOT] Missing defineModule call in module file (${modulePath}).`);
        }

        if (defineModuleCalls.length > 1) {
          throw new Error(`[Zipbul AOT] Multiple defineModule calls in module file (${modulePath}).`);
        }

        const exportedCall = defineModuleCalls.find(call => typeof call.exportedName === 'string');

        if (!exportedCall) {
          throw new Error(`[Zipbul AOT] Module marker must be exported from module file (${modulePath}).`);
        }
      }

      if (rawDef?.nameDeclared === true && !isNonEmptyString(rawDef.name)) {
        throw new Error(`[Zipbul AOT] Module name must be a statically determinable string literal (${modulePath}).`);
      }

      if (!moduleFile) {
        continue;
      }

      const moduleRootDir = dirname(modulePath);
      const moduleName = this.moduleNameByPath.get(modulePath) ?? rawDef?.name ?? basename(moduleRootDir);
      const syntheticMeta: ClassMetadata = {
        className: moduleName,
        heritage: undefined,
        decorators: [],
        constructorParams: [],
        methods: [],
        properties: [],
        imports: moduleFile.imports ?? {},
      };
      const node = new ModuleNode(syntheticMeta);

      node.filePath = modulePath;
      node.name = moduleName;

      if (rawDef !== undefined) {
        node.moduleDefinition = rawDef;
      }

      this.modules.set(modulePath, node);

      const sortedOwnedFiles = Array.from(files).sort(compareCodePoint);
      const injectDeps: string[] = [];

      sortedOwnedFiles.forEach(filePath => {
        const fileAnalysis = this.fileMap.get(filePath);

        if (!fileAnalysis) {
          return;
        }

        const fileInjectDeps = this.collectInjectDeps(fileAnalysis);

        injectDeps.push(...fileInjectDeps);

        fileAnalysis.classes.forEach(cls => {
          this.classMap.set(cls.className, node);
          this.classDefinitions.set(cls.className, { metadata: cls, filePath });

          const isController = cls.decorators.some(d => d.name === 'RestController');
          const isInjectable = cls.decorators.some(d => d.name === 'Injectable');

          if (isController) {
            node.controllers.add(cls.className);
          }

          if (isInjectable) {
            const token = cls.className;
            const injectableDec = cls.decorators.find(d => d.name === 'Injectable');
            const options = this.parseInjectableOptions(injectableDec?.arguments?.[0], modulePath, moduleName);

            const providerRef: ProviderRef = {
              token,
              metadata: cls,
              visibility: options.visibility,
              scope: options.scope,
              filePath: filePath,
            };
            if (options.visibleTo !== undefined) {
              providerRef.visibleTo = options.visibleTo;
            }
            node.providers.set(token, providerRef);
          }
        });
      });

      if (injectDeps.length > 0) {
        const normalized = Array.from(new Set(injectDeps)).sort(compareCodePoint);

        this.moduleInjectDeps.set(modulePath, normalized);
      }

      if (rawDef?.providers) {
        rawDef.providers.forEach((p: ProviderTokenValue) => {
          const record = this.asRecord(p);

          if (record && typeof record.__zipbul_spread === 'string') {
            node.dynamicProviderBundles.add(record.__zipbul_spread);

            return;
          }

          const ref = this.normalizeProvider(p, modulePath, moduleName);

          if (node.providers.has(ref.token) && !this.isImplicit(node.providers.get(ref.token))) {
            throw new Error(
              `[Zipbul AOT] Ambiguous provider '${ref.token}' in module '${node.name}' (${node.filePath}). Duplicate explicit definition.`,
            );
          }

          if (node.providers.has(ref.token)) {
            const prev = node.providers.get(ref.token);

            if (this.isImplicit(prev)) {
              const metaRecord = this.asRecord(ref.metadata);

              if (metaRecord && typeof metaRecord.__zipbul_ref === 'string') {
                const prevMeta = prev?.metadata;
                const prevFilePath = prev?.filePath;
                const prevScope = prev?.scope;
                const prevVisibility = prev?.visibility;
                const prevVisibleTo = prev?.visibleTo;

                if (prevMeta !== undefined) {
                  ref.metadata = prevMeta;
                }

                if (prevFilePath !== undefined) {
                  ref.filePath = prevFilePath;
                }

                if (ref.scope === undefined && prevScope !== undefined) {
                  ref.scope = prevScope;
                }

                if (ref.visibility === 'module' && prevVisibility !== undefined) {
                  ref.visibility = prevVisibility;
                }

                if (ref.visibleTo === undefined && prevVisibleTo !== undefined) {
                  ref.visibleTo = prevVisibleTo;
                }
              }
            }
          }

          node.providers.set(ref.token, ref);
        });
      }
    }

    this.validateVisibilityAndScope();

    if (this.gildash) {
      this.validateProviderImplementations();
    }

    const cycles = this.detectCycles();

    if (cycles.length > 0) {
      const summary = cycles.map(c => c.path.join(' -> ')).join('\n');

      throw new Error(`[Zipbul AOT] Circular dependency detected:\n${summary}`);
    }

    return this.modules;
  }

  detectCycles(): CyclePath[] {
    const nodes = Array.from(this.modules.values()).sort((a, b) => compareCodePoint(a.filePath, b.filePath));
    const adjacency = new Map<ModuleNode, ModuleNode[]>();

    nodes.forEach(node => {
      const next = new Set<ModuleNode>();
      const providerTokens = Array.from(node.providers.keys()).sort(compareCodePoint);
      const injectDeps = this.moduleInjectDeps.get(node.filePath) ?? [];

      providerTokens.forEach(token => {
        const provider = node.providers.get(token);

        if (!provider) {
          return;
        }

        const deps = this.extractDeps(provider);
        const sortedDeps = [...deps].sort(compareCodePoint);

        sortedDeps.forEach(depToken => {
          const target = this.classMap.get(depToken);

          if (!target) {
            return;
          }

          if (target === node) {
            return;
          }

          next.add(target);
        });
      });

      injectDeps.forEach(depToken => {
        const target = this.classMap.get(depToken);

        if (!target) {
          return;
        }

        if (target === node) {
          return;
        }

        next.add(target);
      });
      adjacency.set(
        node,
        Array.from(next).sort((a, b) => compareCodePoint(a.filePath, b.filePath)),
      );
    });

    const cycles: CyclePath[] = [];
    const cycleKeys = new Set<string>();
    const visited = new Set<ModuleNode>();
    const inStack = new Set<ModuleNode>();
    const stack: ModuleNode[] = [];

    const recordCycle = (cycle: ModuleNode[]): void => {
      const names = cycle.map(n => n.name);
      const normalized = this.normalizeCycle(names);
      const key = normalized.join('->');

      if (cycleKeys.has(key)) {
        return;
      }

      cycleKeys.add(key);
      cycles.push({ path: normalized });
    };

    const dfs = (node: ModuleNode): void => {
      if (inStack.has(node)) {
        const startIndex = stack.indexOf(node);

        if (startIndex >= 0) {
          recordCycle(stack.slice(startIndex).concat(node));
        }

        return;
      }

      if (visited.has(node)) {
        return;
      }

      visited.add(node);
      inStack.add(node);
      stack.push(node);

      const next = adjacency.get(node) ?? [];

      next.forEach(n => {
        dfs(n);
      });
      stack.pop();
      inStack.delete(node);
    };

    nodes.forEach(node => {
      dfs(node);
    });

    return cycles;
  }

  resolveToken(_moduleName: string, _token: string): string | null {
    return null;
  }

  private isImplicit(ref: ProviderRef | undefined): boolean {
    return this.isClassMetadata(ref?.metadata);
  }

  private validateVisibilityAndScope() {
    this.modules.forEach(node => {
      const injectDeps = this.moduleInjectDeps.get(node.filePath) ?? [];

      injectDeps.forEach(depToken => {
        this.assertVisibility(node, depToken, 'inject');
      });

      node.providers.forEach(provider => {
        if (provider.metadata === undefined) {
          return;
        }

        const deps = this.extractDeps(provider);

        deps.forEach(depToken => {
          this.assertVisibility(node, depToken, provider.token);

          const sourceScope = provider.scope ?? 'singleton';
          const targetModule = this.classMap.get(depToken);

          if (!targetModule) {
            return;
          }

          const targetProvider = targetModule.providers.get(depToken);

          if (!targetProvider) {
            return;
          }

          const targetScope = targetProvider.scope ?? 'singleton';

          if (sourceScope === 'singleton' && targetScope === 'request') {
            throw new Error(
              `[Zipbul AOT] Scope Violation: Singleton '${provider.token}' cannot inject Request-Scoped '${depToken}'.`,
            );
          }
        });
      });
    });
  }

  private validateProviderImplementations(): void {
    if (!this.gildash) return;

    for (const node of this.modules.values()) {
      for (const provider of node.providers.values()) {
        const lookupPath = provider.filePath ?? this.classDefinitions.get(provider.token)?.filePath;
        if (!lookupPath) continue;

        try {
          const sym = this.gildash.getFullSymbol(provider.token, lookupPath);
          if (!sym || sym.kind !== 'interface') continue;

          const impls = this.gildash.getImplementations(provider.token, lookupPath);
          if (impls.length === 0) continue;

          const implNames = new Set(impls.map(i => i.symbolName));

          for (const candidate of node.providers.values()) {
            if (!this.isClassMetadata(candidate.metadata)) continue;
            const cls = (candidate.metadata as ClassMetadata).className;
            if (!implNames.has(cls)) {
              this.warnings.push(
                `[Zipbul AOT] Provider '${cls}' in module '${node.name}' is registered for interface '${provider.token}' but does not implement it.`,
              );
            }
          }
        } catch { /* getFullSymbol/getImplementations 실패 시 무시 */ }
      }
    }
  }

  async validateInheritedScopes(): Promise<void> {
    if (!this.gildash) return;

    for (const node of this.modules.values()) {
      for (const provider of node.providers.values()) {
        const sourceScope = provider.scope ?? 'singleton';
        if (sourceScope !== 'singleton') continue;

        const classDef = this.classDefinitions.get(provider.token);
        if (!classDef) continue;

        try {
          const chain = await this.gildash.getHeritageChain(provider.token, classDef.filePath);
          this.checkHeritageScopes(chain, provider.token, sourceScope);
        } catch { /* heritage chain 조회 실패 시 무시 */ }
      }
    }
  }

  private checkHeritageScopes(node: HeritageNode, providerToken: string, sourceScope: string): void {
    for (const child of node.children) {
      if (child.kind !== 'extends') continue;

      const parentModule = this.classMap.get(child.symbolName);
      if (!parentModule) continue;

      const parentProvider = parentModule.providers.get(child.symbolName);
      if (!parentProvider) continue;

      const parentScope = parentProvider.scope ?? 'singleton';
      if (sourceScope === 'singleton' && parentScope === 'request') {
        throw new Error(
          `[Zipbul AOT] Scope Violation: Singleton '${providerToken}' inherits Request-Scoped dependency through '${child.symbolName}'.`,
        );
      }

      this.checkHeritageScopes(child, providerToken, sourceScope);
    }
  }

  private assertVisibility(node: ModuleNode, depToken: string, sourceLabel: string): void {
    const targetModule = this.classMap.get(depToken);

    if (!targetModule) {
      return;
    }

    if (targetModule === node) {
      return;
    }

    const targetProvider = targetModule.providers.get(depToken);

    if (!targetProvider) {
      return;
    }

    if (targetProvider.visibility === 'all') {
      return;
    }

    if (targetProvider.visibility === 'module') {
      throw new Error(
        `[Zipbul AOT] Visibility Violation: '${sourceLabel}' in module '${node.name}' tries to inject '${depToken}' from '${targetModule.name}', but it is module-only.`,
      );
    }

    const allowlist = targetProvider.visibleTo ?? [];

    if (!allowlist.includes(node.name)) {
      throw new Error(
        `[Zipbul AOT] Visibility Violation: '${sourceLabel}' in module '${node.name}' tries to inject '${depToken}' from '${targetModule.name}', but it is not allowlisted.`,
      );
    }
  }

  private extractDeps(provider: ProviderRef): string[] {
    if (provider.metadata === undefined) {
      return [];
    }

    if (this.isClassMetadata(provider.metadata)) {
      return provider.metadata.constructorParams
        .map(p => {
          const injectDec = p.decorators.find(d => d.name === 'Inject');

          if (injectDec !== undefined) {
            const token = injectDec.arguments[0];

            if (typeof token === 'string') {
              return token;
            }

            const extracted = this.extractTokenName(token);

            if (extracted !== 'UNKNOWN') {
              return extracted;
            }
          }

          return this.extractTokenName(p.type);
        })
        .filter(v => v !== 'UNKNOWN');
    }

    const record = this.asRecord(provider.metadata);

    if (record && isAnalyzerValueArray(record.inject)) {
      return record.inject.map(v => this.extractTokenName(v)).filter(v => v !== 'UNKNOWN');
    }

    return [];
  }

  private normalizeProvider(p: ProviderTokenValue, modulePath: string, moduleName: string): ProviderRef {
    let token = 'UNKNOWN';
    const record = this.asRecord(p);
    const options = this.parseInjectableOptions(record ?? undefined, modulePath, moduleName);

    if (record?.provide !== undefined) {
      token = this.extractTokenName(record.provide);
    } else if (typeof p === 'function') {
      token = p.name;
    } else if (record && typeof record.__zipbul_ref === 'string') {
      token = record.__zipbul_ref;
      if (this.gildash && typeof record.__zipbul_import_source === 'string') {
        try {
          const resolved = this.gildash.resolveSymbol(record.__zipbul_ref, record.__zipbul_import_source);
          if (!resolved.circular) token = resolved.originalName;
        } catch { /* resolve 실패 → 기존 ref 이름 유지 */ }
      }
    }

    const metadata = this.isClassMetadata(p) ? p : (record ?? undefined);

    const ref: ProviderRef = {
      token,
      metadata,
      visibility: options.visibility,
    };
    if (options.visibleTo !== undefined) {
      ref.visibleTo = options.visibleTo;
    }
    if (options.scope !== undefined) {
      ref.scope = options.scope;
    }
    return ref;
  }

  private extractTokenName(t: ProviderTokenValue | AnalyzerValue): string {
    if (typeof t === 'string') {
      return t;
    }

    if (typeof t === 'function') {
      return t.name;
    }

    if (typeof t === 'symbol') {
      return t.description ?? t.toString();
    }

    const record = this.asRecord(t);

    if (record && typeof record.__zipbul_ref === 'string') {
      if (this.gildash && typeof record.__zipbul_import_source === 'string') {
        try {
          const resolved = this.gildash.resolveSymbol(record.__zipbul_ref, record.__zipbul_import_source);
          if (!resolved.circular) return resolved.originalName;
        } catch { /* fallback */ }
      }
      return record.__zipbul_ref;
    }

    return 'UNKNOWN';
  }

  private normalizeCycle(path: readonly string[]): string[] {
    if (path.length === 0) {
      return [];
    }

    const unique = path[0] === path[path.length - 1] ? path.slice(0, -1) : [...path];

    if (unique.length === 0) {
      return [];
    }

    let best = unique;

    for (let i = 1; i < unique.length; i += 1) {
      const rotated = unique.slice(i).concat(unique.slice(0, i));

      if (this.compareStringArray(rotated, best) < 0) {
        best = rotated;
      }
    }

    return best;
  }

  private compareStringArray(a: readonly string[], b: readonly string[]): number {
    const len = Math.min(a.length, b.length);

    for (let i = 0; i < len; i += 1) {
      const left = a[i];
      const right = b[i];

      if (left === undefined || right === undefined) {
        continue;
      }

      const diff = compareCodePoint(left, right);

      if (diff !== 0) {
        return diff;
      }
    }

    return a.length - b.length;
  }

  private isClassMetadata(value: ProviderMetadata | ProviderTokenValue): value is ClassMetadata {
    if (!isRecordValue(value)) {
      return false;
    }

    const record = value;

    return (
      typeof record.className === 'string' &&
      Array.isArray(record.decorators) &&
      Array.isArray(record.constructorParams) &&
      Array.isArray(record.methods) &&
      Array.isArray(record.properties) &&
      typeof record.imports === 'object'
    );
  }

  private parseInjectableOptions(
    value: ProviderMetadata | undefined,
    modulePath: string,
    moduleName: string,
  ): InjectableOptions {
    const record = value === undefined ? null : this.asRecord(value);
    const visibility = this.resolveVisibility(record?.visibleTo, modulePath, moduleName);
    const scope = this.resolveScope(record?.scope, record?.lifetime);

    const opts: InjectableOptions = {
      visibility: visibility.kind,
      scope,
    };
    if (visibility.visibleTo !== undefined) {
      opts.visibleTo = visibility.visibleTo;
    }
    return opts;
  }

  private resolveVisibility(
    visibleTo: AnalyzerValue | undefined,
    modulePath: string,
    moduleName: string,
  ): VisibilityResolution {
    if (visibleTo === undefined) {
      return { kind: 'module' };
    }

    if (typeof visibleTo === 'string') {
      if (visibleTo === 'all') {
        return { kind: 'all' };
      }

      if (visibleTo === 'module') {
        return { kind: 'module' };
      }

      throw new Error(`[Zipbul AOT] Invalid Injectable visibleTo value: '${visibleTo}'.`);
    }

    const arrayValue = isAnalyzerValueArray(visibleTo) ? visibleTo : null;

    if (arrayValue === null) {
      throw new Error('[Zipbul AOT] Injectable visibleTo must be "all", "module", or ModuleMarkerList.');
    }

    if (arrayValue.length === 0) {
      throw new Error('[Zipbul AOT] Injectable visibleTo allowlist must not be empty.');
    }

    const resolved = arrayValue
      .map(token => this.resolveModuleMarker(token, modulePath, moduleName))
      .filter((value): value is string => typeof value === 'string');

    if (resolved.length !== arrayValue.length) {
      throw new Error('[Zipbul AOT] Injectable visibleTo contains non-determinable module markers.');
    }

    const unique = Array.from(new Set(resolved)).sort(compareCodePoint);

    return { kind: 'allowlist', visibleTo: unique };
  }

  private resolveScope(scope: AnalyzerValue | undefined, legacyLifetime: AnalyzerValue | undefined): InjectableOptions['scope'] {
    const raw = typeof scope === 'string' ? scope : typeof legacyLifetime === 'string' ? legacyLifetime : undefined;

    if (raw === undefined) {
      return 'singleton';
    }

    if (raw === 'singleton' || raw === 'transient') {
      return raw;
    }

    if (raw === 'request' || raw === 'request-context') {
      return 'request';
    }

    throw new Error(`[Zipbul AOT] Invalid provider scope '${raw}'.`);
  }

  private collectModuleNames(moduleEntries: Array<[string, Set<string>]>): Map<string, string> {
    const names = new Map<string, string>();

    moduleEntries.forEach(([modulePath]) => {
      const moduleFile = this.fileMap.get(modulePath);
      const rawDef = moduleFile?.moduleDefinition;
      const moduleRootDir = dirname(modulePath);
      const moduleName = rawDef?.name ?? basename(moduleRootDir);

      names.set(modulePath, moduleName);
    });

    return names;
  }

  private collectModuleMarkerExports(moduleEntries: Array<[string, Set<string>]>): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();

    moduleEntries.forEach(([modulePath]) => {
      const moduleFile = this.fileMap.get(modulePath);
      const exports = new Set<string>();
      const defineCalls = moduleFile?.defineModuleCalls ?? [];

      defineCalls.forEach(call => {
        if (typeof call.exportedName === 'string' && call.exportedName.length > 0) {
          exports.add(call.exportedName);
        }
      });

      if (exports.size > 0) {
        map.set(modulePath, exports);
      }
    });

    return map;
  }

  private resolveModulePath(importSource: string | undefined): string | null {
    if (typeof importSource !== 'string' || importSource.length === 0) {
      return null;
    }

    const candidates = [
      importSource,
      `${importSource}.ts`,
      `${importSource}/index.ts`,
    ];

    for (const candidate of candidates) {
      if (this.moduleFileSet.has(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private resolveModuleMarker(token: AnalyzerValue, modulePath: string, moduleName: string): string | null {
    const record = this.asRecord(token);

    if (!record || typeof record.__zipbul_ref !== 'string') {
      return null;
    }

    const refName = record.__zipbul_ref;
    const importSource = typeof record.__zipbul_import_source === 'string' ? record.__zipbul_import_source : undefined;
    const targetModulePath = this.resolveModulePath(importSource) ?? modulePath;
    const exports = this.moduleMarkerExports.get(targetModulePath);

    if (!exports || exports.size === 0) {
      return null;
    }

    if (exports.has('default')) {
      return this.moduleNameByPath.get(targetModulePath) ?? moduleName;
    }

    if (exports.has(refName)) {
      return this.moduleNameByPath.get(targetModulePath) ?? moduleName;
    }

    return null;
  }

  private collectInjectDeps(fileAnalysis: FileAnalysis): string[] {
    const injectCalls = fileAnalysis.injectCalls ?? [];

    if (injectCalls.length === 0) {
      return [];
    }

    const deps: string[] = [];

    injectCalls.forEach(call => {
      if (call.tokenKind === 'invalid') {
        throw new Error('[Zipbul AOT] inject() token is not statically determinable.');
      }

      if (call.token === null) {
        throw new Error('[Zipbul AOT] inject() token is not statically determinable.');
      }

      const tokenName = this.extractTokenName(call.token);

      if (!tokenName || tokenName === 'UNKNOWN') {
        throw new Error('[Zipbul AOT] inject() token is not statically determinable.');
      }

      deps.push(tokenName);
    });

    return deps;
  }

  private asRecord(value: ProviderMetadata | ProviderTokenValue): AnalyzerValueRecord | null {
    if (!isRecordValue(value)) {
      return null;
    }

    return value;
  }
}
