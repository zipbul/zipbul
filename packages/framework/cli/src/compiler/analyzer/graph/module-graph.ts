import { basename, dirname } from 'path';

import type { Gildash } from '@zipbul/gildash';

import type { ClassMetadata } from '../interfaces';


import type { ClassDefinition, CyclePath, FileAnalysis, ProviderRef, ProviderTokenValue } from './interfaces';

import {
  ZIPBUL_REF, ZIPBUL_SPREAD,
  ZIPBUL_FACTORY_CODE,
  SCOPED_KEY_SEPARATOR,
} from '@zipbul/common';
import { compareCodePoint } from '../../../common';
import { ModuleDiscovery } from '../module-discovery';
import { ModuleNode } from './module-node';
import { toRecord, isClassMetadata, isNonEmptyString } from '../type-guards';
import { normalizeCycle, collectModuleNames, collectModuleMarkerExports, collectInjectDeps } from './token-resolver';
import { parseInjectableOptions } from './scope-visibility-resolver';
import { mergeProviderRef, resolveSpreadBundle, normalizeProvider, extractDeps } from './provider-resolver';
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



const INJECTABLE_NAME = 'Injectable';

export class ModuleGraph {
  public modules: Map<string, ModuleNode> = new Map();
  public classMap: Map<string, ModuleNode> = new Map();
  public classDefinitions: Map<string, ClassDefinition> = new Map();
  public warnings: string[] = [];
  public moduleFileSet: Set<string> = new Set();
  public moduleNameByPath: Map<string, string> = new Map();
  public moduleMarkerExports: Map<string, Set<string>> = new Map();
  public moduleInjectDeps: Map<string, string[]> = new Map();
  /** Provider file path → its inject() dependency tokens (consumer-scoped, for scope validation). */
  public providerInjectDeps: Map<string, string[]> = new Map();
  constructor(
    public readonly fileMap: Map<string, FileAnalysis>,
    public readonly moduleFileName: string,
    public readonly sourceDir?: string,
    public readonly gildash?: Gildash,
  ) {}

  /**
   * Population only. Discovers modules, creates nodes, registers providers.
   *
   * @returns The populated module map.
   * @public
   */
  buildStructure(): Map<string, ModuleNode> {
    this.modules.clear();
    this.classMap.clear();
    this.classDefinitions.clear();
    this.warnings = [];
    this.moduleFileSet.clear();
    this.moduleNameByPath.clear();
    this.moduleMarkerExports.clear();
    this.moduleInjectDeps.clear();
    this.providerInjectDeps.clear();

    const sourceDir = this.sourceDir;
    const allFiles = Array.from(this.fileMap.keys())
      .filter(filePath => sourceDir === undefined || filePath.startsWith(sourceDir))
      .sort(compareCodePoint);
    const discovery = new ModuleDiscovery(allFiles, this.moduleFileName);
    const moduleMap = discovery.discover();
    const orphans = discovery.getOrphans();

    this.moduleFileSet = new Set(moduleMap.keys());

    if (orphans.size > 0) {
      const sortedOrphans = Array.from(orphans.values()).sort(compareCodePoint);
      const summary = sortedOrphans.join('\n');

      throw new Error(`Orphan files detected:\n${summary}`);
    }

    const moduleEntries = Array.from(moduleMap.entries()).sort(([a], [b]) => compareCodePoint(a, b));

    this.moduleNameByPath = collectModuleNames(moduleEntries, this.fileMap);
    this.moduleMarkerExports = collectModuleMarkerExports(moduleEntries, this.fileMap);

    for (const [modulePath, files] of moduleEntries) {
      const moduleFile = this.fileMap.get(modulePath);
      const rawDef = moduleFile?.moduleDefinition;

      if (moduleFile) {
        const defineModuleCalls = moduleFile.defineModuleCalls ?? [];

        if (defineModuleCalls.length === 0) {
          throw new Error(`Missing defineModule call in module file (${modulePath}).`);
        }

        if (defineModuleCalls.length > 1) {
          throw new Error(`Multiple defineModule calls in module file (${modulePath}).`);
        }

        const exportedCall = defineModuleCalls.find(call => typeof call.exportedName === 'string');

        if (!exportedCall) {
          throw new Error(`Module marker must be exported from module file (${modulePath}).`);
        }
      }

      if (rawDef?.nameDeclared === true && !isNonEmptyString(rawDef.name)) {
        throw new Error(`Module name must be a statically determinable string literal (${modulePath}).`);
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

      for (const filePath of sortedOwnedFiles) {
        const fileAnalysis = this.fileMap.get(filePath);

        if (!fileAnalysis) {
          continue;
        }

        const fileInjectDeps = collectInjectDeps(fileAnalysis, this.gildash, this.warnings);

        injectDeps.push(...fileInjectDeps);

        if (fileInjectDeps.length > 0) {
          this.providerInjectDeps.set(filePath, fileInjectDeps);
        }

        for (const cls of fileAnalysis.classes) {
          this.classMap.set(cls.className, node);
          this.classDefinitions.set(cls.className, { metadata: cls, filePath });

          const isInjectable = cls.decorators.some(d => d.name === INJECTABLE_NAME);

          if (isInjectable) {
            const token = cls.className;
            const injectableDec = cls.decorators.find(d => d.name === INJECTABLE_NAME);
            const options = parseInjectableOptions(
              injectableDec?.arguments?.[0],
              modulePath, moduleName,
              this.moduleFileSet, this.moduleNameByPath, this.moduleMarkerExports,
            );

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
        }
      }

      if (injectDeps.length > 0) {
        const normalized = Array.from(new Set(injectDeps)).sort(compareCodePoint);

        this.moduleInjectDeps.set(modulePath, normalized);
      }

      if (rawDef?.providers) {
        for (const p of rawDef.providers as ProviderTokenValue[]) {
          const record = toRecord(p);

          if (record && record[ZIPBUL_SPREAD] !== undefined) {
            const resolved = resolveSpreadBundle(record[ZIPBUL_SPREAD], modulePath, moduleName, this.fileMap, this.gildash);

            for (const entry of resolved) {
              const ref = normalizeProvider(
                entry, modulePath, moduleName,
                this.gildash, this.warnings,
                this.moduleFileSet, this.moduleNameByPath, this.moduleMarkerExports,
              );

              mergeProviderRef(node, ref, moduleName);
            }

            continue;
          }

          const ref = normalizeProvider(
            p, modulePath, moduleName,
            this.gildash, this.warnings,
            this.moduleFileSet, this.moduleNameByPath, this.moduleMarkerExports,
          );

          mergeProviderRef(node, ref, moduleName);
        }
      }
    }

    return this.modules;
  }

  /**
   * Runs all synchronous validations. Must be called after `buildStructure()`.
   *
   * @public
   */
  validate(): void {
    validateModuleNameUniqueness(this.modules);
    validateVisibilityAndScope(this.modules, this.classMap, this.moduleInjectDeps, this.providerInjectDeps, this.gildash, this.warnings);

    if (this.gildash) {
      validateProviderImplementations(this.modules, this.classDefinitions, this.gildash, this.warnings);
      validateProviderTypeCompatibility(this.modules, this.classDefinitions, this.gildash, this.warnings);
      validateFactoryParamTypes(this.modules, this.classDefinitions, this.gildash, this.warnings);
    }

    validateFactoryInjectTokens(this.modules);

    const cycles = this.detectCycles();

    if (cycles.length > 0) {
      const summary = cycles.map(c => c.path.join(' -> ')).join('\n');

      throw new Error(`Circular dependency detected:\n${summary}`);
    }
  }

  /**
   * Backward-compatible entry point. Calls `buildStructure()` then `validate()`.
   *
   * @returns The populated module map.
   * @public
   */
  build(): Map<string, ModuleNode> {
    this.buildStructure();
    this.validate();
    return this.modules;
  }

  /**
   * Computes a deterministic DI signature hash per module.
   * Two graphs with identical DI structure produce identical signatures.
   *
   * @returns Map of module file path to signature string.
   * @public
   */
  computeSignatures(): Map<string, string> {
    const signatures = new Map<string, string>();

    for (const [modulePath, node] of this.modules) {
      signatures.set(modulePath, this.computeModuleSignature(node));
    }

    return signatures;
  }

  /**
   * Detects providers that are registered but never referenced by any consumer.
   * Must be called after `registerControllers()` so controller deps are visible.
   *
   * @public
   */
  validateUnusedProviders(): void {
    const depsExtractor = (provider: ProviderRef): string[] => extractDeps(provider, this.gildash, this.warnings);

    validateUnusedProviders(
      this.modules, this.moduleInjectDeps,
      this.gildash, this.warnings, depsExtractor,
    );
  }

  detectCycles(): CyclePath[] {
    const nodes = Array.from(this.modules.values()).sort((a, b) => compareCodePoint(a.filePath, b.filePath));
    const adjacency = new Map<ModuleNode, ModuleNode[]>();

    for (const node of nodes) {
      const next = new Set<ModuleNode>();
      const providerTokens = Array.from(node.providers.keys()).sort(compareCodePoint);
      const injectDeps = this.moduleInjectDeps.get(node.filePath) ?? [];

      for (const token of providerTokens) {
        const provider = node.providers.get(token);

        if (!provider) {
          continue;
        }

        const deps = extractDeps(provider, this.gildash, this.warnings);
        const sortedDeps = [...deps].sort(compareCodePoint);

        for (const depToken of sortedDeps) {
          const target = this.classMap.get(depToken);

          if (!target) {
            continue;
          }

          if (target === node) {
            continue;
          }

          next.add(target);
        }
      }

      for (const depToken of injectDeps) {
        const target = this.classMap.get(depToken);

        if (!target) {
          continue;
        }

        if (target === node) {
          continue;
        }

        next.add(target);
      }

      adjacency.set(
        node,
        Array.from(next).sort((a, b) => compareCodePoint(a.filePath, b.filePath)),
      );
    }

    const cycles: CyclePath[] = [];
    const cycleKeys = new Set<string>();
    const visited = new Set<ModuleNode>();
    const inStack = new Set<ModuleNode>();
    const stack: ModuleNode[] = [];

    const recordCycle = (cycle: ModuleNode[]): void => {
      const names = cycle.map(n => n.name);
      const normalized = normalizeCycle(names);
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

      for (const n of next) {
        dfs(n);
      }

      stack.pop();
      inStack.delete(node);
    };

    for (const node of nodes) {
      dfs(node);
    }

    return cycles;
  }

  resolveToken(_moduleName: string, _token: string): string | null {
    return null;
  }

  /**
   * Returns a set of all scoped provider keys across all modules.
   * Format: `moduleName::providerToken` (uses SCOPED_KEY_SEPARATOR).
   *
   * @returns Set of scoped keys including both providers and controllers.
   * @public
   */
  getAllRegisteredKeys(): Set<string> {
    const keys = new Set<string>();

    for (const node of this.modules.values()) {
      for (const token of node.providers.keys()) {
        keys.add(`${node.name}${SCOPED_KEY_SEPARATOR}${token}`);
      }

      for (const ctrlName of node.controllers) {
        keys.add(`${node.name}${SCOPED_KEY_SEPARATOR}${ctrlName}`);
      }
    }

    return keys;
  }

  /**
   * Registers controllers based on adapter-provided controller decorator names.
   * Must be called after adapterResolution to maintain adapter neutrality.
   *
   * @param controllerDecoratorNames - Decorator names that identify a controller (e.g. `["RestController"]`).
   * @public
   */
  registerControllers(controllerDecoratorNames: readonly string[]): void {
    const nameSet = new Set(controllerDecoratorNames);

    for (const [className, def] of this.classDefinitions) {
      const isController = def.metadata.decorators.some(d => nameSet.has(d.name));

      if (!isController) {
        continue;
      }

      const node = this.classMap.get(className);

      if (node) {
        node.controllers.add(className);
      }
    }
  }

  /**
   * Validates inherited scope compatibility via gildash heritage chain.
   *
   * @public
   */
  async validateInheritedScopes(): Promise<void> {
    if (!this.gildash) return;

    await validateInheritedScopes(
      this.modules, this.classDefinitions, this.classMap,
      this.gildash, this.warnings,
    );
  }

  // ── Signature computation (stays in orchestrator — tightly coupled) ──

  private computeModuleSignature(node: ModuleNode): string {
    const parts: string[] = [node.name];

    const sortedProviders = Array.from(node.providers.entries()).sort(([a], [b]) => compareCodePoint(a, b));

    for (const [token, ref] of sortedProviders) {
      const deps = extractDeps(ref, this.gildash, this.warnings).sort(compareCodePoint);
      const metaKind = this.classifyProviderMetadata(ref);
      const factoryCode = this.extractFactoryCode(ref);
      const visibleTo = ref.visibleTo !== undefined ? ref.visibleTo.join(',') : '';
      const target = this.extractProviderTarget(ref);

      parts.push(`p:${token}|${ref.visibility}|${visibleTo}|${ref.scope ?? ''}|${deps.join(',')}|${metaKind}|${target}|${factoryCode}|${ref.filePath ?? ''}`);
    }

    const sortedControllers = Array.from(node.controllers).sort(compareCodePoint);

    for (const ctrl of sortedControllers) {
      parts.push(`c:${ctrl}`);
    }

    const injectDeps = this.moduleInjectDeps.get(node.filePath);

    if (injectDeps !== undefined) {
      for (const dep of injectDeps) {
        parts.push(`i:${dep}`);
      }
    }

    const sortedDynamicImports = Array.from(node.dynamicImports)
      .map(value => {
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          const sorted = Object.keys(value).sort();

          return JSON.stringify(value, sorted);
        }

        return JSON.stringify(value);
      })
      .sort(compareCodePoint);

    for (const key of sortedDynamicImports) {
      parts.push(`d:${key}`);
    }

    return Bun.hash(parts.join('\n')).toString(36);
  }

  private classifyProviderMetadata(ref: ProviderRef): string {
    if (ref.metadata === undefined) {
      return 'none';
    }

    if (isClassMetadata(ref.metadata)) {
      return 'class';
    }

    const record = toRecord(ref.metadata);

    if (record === null) {
      return 'unknown';
    }

    if (record.useFactory !== undefined) {
      return 'useFactory';
    }

    if (record.useClass !== undefined) {
      return 'useClass';
    }

    if (record.useValue !== undefined) {
      return 'useValue';
    }

    if (record.useExisting !== undefined) {
      return 'useExisting';
    }

    return 'ref';
  }

  private extractProviderTarget(ref: ProviderRef): string {
    const record = toRecord(ref.metadata);

    if (record === null) {
      return '';
    }

    if (typeof record.useClass === 'string') {
      return record.useClass;
    }

    const useClassRecord = toRecord(record.useClass);

    if (useClassRecord !== null && typeof useClassRecord[ZIPBUL_REF] === 'string') {
      return useClassRecord[ZIPBUL_REF];
    }

    if (typeof record.useExisting === 'string') {
      return record.useExisting;
    }

    const useExistingRecord = toRecord(record.useExisting);

    if (useExistingRecord !== null && typeof useExistingRecord[ZIPBUL_REF] === 'string') {
      return useExistingRecord[ZIPBUL_REF];
    }

    return '';
  }

  private extractFactoryCode(ref: ProviderRef): string {
    const record = toRecord(ref.metadata);

    if (record === null) {
      return '';
    }

    const factoryRecord = toRecord(record.useFactory);

    if (factoryRecord === null) {
      return '';
    }

    const code = factoryRecord[ZIPBUL_FACTORY_CODE];

    return typeof code === 'string' ? code : '';
  }
}
