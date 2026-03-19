import { basename, dirname } from 'path';

import type { Gildash, HeritageNode } from '@zipbul/gildash';

import type { ClassMetadata } from '../interfaces';
import type { AnalyzerValue, AnalyzerValueRecord } from '../types';
import type { CyclePath, ProviderRef, FileAnalysis } from './interfaces';

import {
  ZIPBUL_REF, ZIPBUL_IMPORT_SOURCE, ZIPBUL_SPREAD, ZIPBUL_CALL, ZIPBUL_UNRESOLVABLE,
  ZIPBUL_FACTORY_CODE,
  VISIBILITY_ALL, VISIBILITY_MODULE,
  SCOPE_SINGLETON, SCOPE_REQUEST, SCOPE_TRANSIENT,
  SCOPED_KEY_SEPARATOR,
} from '@zipbul/common';
import { Logger } from '@zipbul/logger';
import { compareCodePoint } from '../../../common';
import { ModuleDiscovery } from '../module-discovery';
import { ModuleNode } from './module-node';
import { isRecordValue, isAnalyzerValueArray, isNonEmptyString, isUnresolvable } from '../type-guards';

const logger = new Logger('ModuleGraph');

const INJECTABLE_NAME = 'Injectable';

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
    private readonly sourceDir?: string,
    private readonly gildash?: Gildash,
  ) {}

  /**
   * Population only. Discovers modules, creates nodes, registers providers.
   *
   * @returns The populated module map.
   * @public
   */
  buildStructure(): Map<string, ModuleNode> {
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

          const isInjectable = cls.decorators.some(d => d.name === INJECTABLE_NAME);

          if (isInjectable) {
            const token = cls.className;
            const injectableDec = cls.decorators.find(d => d.name === INJECTABLE_NAME);
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

          if (record && record[ZIPBUL_SPREAD] !== undefined) {
            const resolved = this.resolveSpreadBundle(record[ZIPBUL_SPREAD], modulePath, moduleName);

            for (const entry of resolved) {
              const ref = this.normalizeProvider(entry, modulePath, moduleName);

              this.mergeProviderRef(node, ref, moduleName);
            }

            return;
          }

          const ref = this.normalizeProvider(p, modulePath, moduleName);

          this.mergeProviderRef(node, ref, moduleName);
        });
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
    this.validateModuleNameUniqueness();
    this.validateVisibilityAndScope();

    if (this.gildash) {
      this.validateProviderImplementations();
    }

    this.validateFactoryInjectTokens();

    const cycles = this.detectCycles();

    if (cycles.length > 0) {
      const summary = cycles.map(c => c.path.join(' -> ')).join('\n');

      throw new Error(`[Zipbul AOT] Circular dependency detected:\n${summary}`);
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
    for (const node of this.modules.values()) {
      const referencedTokens = this.collectReferencedTokens(node);

      for (const token of node.providers.keys()) {
        if (node.controllers.has(token)) {
          continue;
        }

        if (!referencedTokens.has(token)) {
          this.warnings.push(
            `[Zipbul AOT] Provider '${token}' in module '${node.name}' is registered but never referenced.`,
          );
        }
      }
    }
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

  private mergeProviderRef(node: ModuleNode, ref: ProviderRef, moduleName: string): void {
    if (node.providers.has(ref.token) && !this.isImplicit(node.providers.get(ref.token))) {
      throw new Error(
        `[Zipbul AOT] Ambiguous provider '${ref.token}' in module '${moduleName}' (${node.filePath}). Duplicate explicit definition.`,
      );
    }

    if (node.providers.has(ref.token)) {
      const prev = node.providers.get(ref.token);

      if (this.isImplicit(prev)) {
        const metaRecord = this.asRecord(ref.metadata);

        if (metaRecord && typeof metaRecord[ZIPBUL_REF] === 'string') {
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

          if (ref.visibility === VISIBILITY_MODULE && prevVisibility !== undefined) {
            ref.visibility = prevVisibility;
          }

          if (ref.visibleTo === undefined && prevVisibleTo !== undefined) {
            ref.visibleTo = prevVisibleTo;
          }
        }
      }
    }

    node.providers.set(ref.token, ref);
  }

  private resolveSpreadBundle(spreadValue: AnalyzerValue, modulePath: string, moduleName: string): AnalyzerValue[] {
    if (isAnalyzerValueArray(spreadValue)) {
      return this.flattenSpreadArray(spreadValue, modulePath, moduleName);
    }

    const record = this.asRecord(spreadValue);

    if (record && typeof record[ZIPBUL_REF] === 'string') {
      const refString = record[ZIPBUL_REF];
      const importSource = typeof record[ZIPBUL_IMPORT_SOURCE] === 'string' ? record[ZIPBUL_IMPORT_SOURCE] : undefined;
      const segments = refString.split('.');
      const varName = segments[0];
      let propertyPath = segments.slice(1);

      if (!isNonEmptyString(varName)) {
        throw this.buildSpreadError(moduleName, modulePath, refString, '변수명을 파싱할 수 없습니다.');
      }

      let targetValue: AnalyzerValue;

      if (importSource !== undefined) {
        let resolvedFile: string | undefined;
        let resolvedName: string | undefined;

        if (this.gildash) {
          try {
            const resolved = this.gildash.resolveSymbol(varName, importSource);

            if (!resolved.circular) {
              resolvedFile = resolved.filePath;
              resolvedName = resolved.originalName;
            }
          } catch {
            /* fallthrough to direct lookup */
          }
        }

        if (resolvedFile === undefined) {
          resolvedFile = importSource;
          resolvedName = varName;
        }

        const fileAnalysis = this.findFileAnalysis(resolvedFile);
        const exportedValues = fileAnalysis?.exportedValues;

        if (exportedValues === undefined) {
          throw this.buildSpreadError(moduleName, modulePath, refString, `파일 '${resolvedFile}'에서 exported values를 찾을 수 없습니다.`);
        }

        targetValue = exportedValues[resolvedName ?? varName];

        if (targetValue === undefined && propertyPath.length > 0) {
          const firstProp = propertyPath[0];

          if (isNonEmptyString(firstProp)) {
            targetValue = exportedValues[firstProp];

            if (targetValue !== undefined) {
              propertyPath = propertyPath.slice(1);
            }
          }
        }

        if (targetValue === undefined) {
          throw this.buildSpreadError(moduleName, modulePath, refString, `'${resolvedName ?? varName}'를 찾을 수 없습니다.`);
        }
      } else {
        const fileAnalysis = this.fileMap.get(modulePath);
        const localValues = fileAnalysis?.localValues;

        if (localValues === undefined) {
          throw this.buildSpreadError(moduleName, modulePath, refString, '로컬 변수를 찾을 수 없습니다.');
        }

        targetValue = localValues[varName];

        if (targetValue === undefined) {
          throw this.buildSpreadError(moduleName, modulePath, refString, `로컬 변수 '${varName}'를 찾을 수 없습니다.`);
        }
      }

      for (const prop of propertyPath) {
        const propRecord = this.asRecord(targetValue);

        if (propRecord === null) {
          throw this.buildSpreadError(moduleName, modulePath, refString, `프로퍼티 '${prop}' 접근 대상이 객체가 아닙니다.`);
        }

        targetValue = propRecord[prop];

        if (targetValue === undefined) {
          throw this.buildSpreadError(moduleName, modulePath, refString, `프로퍼티 '${prop}'를 찾을 수 없습니다.`);
        }
      }

      if (isAnalyzerValueArray(targetValue)) {
        return this.flattenSpreadArray(targetValue, modulePath, moduleName);
      }

      throw this.buildSpreadError(moduleName, modulePath, refString, '해석된 값이 배열이 아닙니다.');
    }

    if (record && record[ZIPBUL_CALL] !== undefined) {
      const callName = typeof record[ZIPBUL_CALL] === 'string' ? record[ZIPBUL_CALL] : 'unknown';

      throw this.buildSpreadError(
        moduleName, modulePath, `${callName}()`,
        '함수 호출 결과는 빌드 타임에 결정할 수 없습니다.',
        '프로바이더를 배열 리터럴 또는 exported const로 선언하세요.',
      );
    }

    if (isUnresolvable(spreadValue)) {
      throw this.buildSpreadError(
        moduleName, modulePath, spreadValue.nodeType,
        `'${spreadValue.nodeType}' 표현식은 빌드 타임에 결정할 수 없습니다.`,
        '프로바이더를 배열 리터럴 또는 exported const로 선언하세요.',
      );
    }

    const valueDescription = typeof spreadValue === 'string' ? spreadValue
      : typeof spreadValue === 'number' ? String(spreadValue)
      : typeof spreadValue === 'boolean' ? String(spreadValue)
      : spreadValue === null ? 'null'
      : spreadValue === undefined ? 'undefined'
      : 'unknown expression';

    throw this.buildSpreadError(
      moduleName, modulePath, valueDescription,
      '스프레드 표현식을 정적으로 해석할 수 없습니다.',
      '프로바이더를 배열 리터럴 또는 exported const로 선언하세요.',
    );
  }

  private flattenSpreadArray(items: readonly AnalyzerValue[], modulePath: string, moduleName: string): AnalyzerValue[] {
    const result: AnalyzerValue[] = [];

    for (const item of items) {
      const record = this.asRecord(item);

      if (record && record[ZIPBUL_SPREAD] !== undefined) {
        const nested = this.resolveSpreadBundle(record[ZIPBUL_SPREAD], modulePath, moduleName);

        result.push(...nested);
      } else {
        result.push(item);
      }
    }

    return result;
  }

  private findFileAnalysis(filePath: string): FileAnalysis | undefined {
    const direct = this.fileMap.get(filePath);

    if (direct !== undefined) {
      return direct;
    }

    const candidates = [
      `${filePath}.ts`,
      `${filePath}/index.ts`,
    ];

    for (const candidate of candidates) {
      const found = this.fileMap.get(candidate);

      if (found !== undefined) {
        return found;
      }
    }

    return undefined;
  }

  private buildSpreadError(moduleName: string, modulePath: string, expression: string, reason: string, solution?: string): Error {
    let message = `[Zipbul AOT] Module '${moduleName}' (${modulePath}):\n  스프레드 표현식 '${expression}' 를 정적으로 해석할 수 없습니다.\n  원인: ${reason}`;

    if (solution !== undefined) {
      message += `\n  해결: ${solution}`;
    }

    return new Error(message);
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

          const sourceScope = provider.scope ?? SCOPE_SINGLETON;
          const targetModule = this.classMap.get(depToken);

          if (!targetModule) {
            return;
          }

          const targetProvider = targetModule.providers.get(depToken);

          if (!targetProvider) {
            return;
          }

          const targetScope = targetProvider.scope ?? SCOPE_SINGLETON;

          if (sourceScope === SCOPE_SINGLETON && targetScope === SCOPE_REQUEST) {
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
        } catch {
          this.warnings.push(
            `[Zipbul AOT] Could not validate provider implementation for '${provider.token}' in module '${node.name}'. Symbol resolution failed.`,
          );
        }
      }
    }
  }

  /**
   * Validates that no two modules share the same name.
   * Module names are used as scoped key prefixes (e.g. `billing::AuditService`),
   * so duplicates would cause silent collisions.
   */
  private validateModuleNameUniqueness(): void {
    const nameToPath = new Map<string, string>();

    for (const [filePath, node] of this.modules) {
      const existing = nameToPath.get(node.name);

      if (existing !== undefined) {
        throw new Error(
          `[Zipbul AOT] Duplicate module name '${node.name}' found in '${filePath}' and '${existing}'. Module names must be unique.`,
        );
      }

      nameToPath.set(node.name, filePath);
    }
  }

  /**
   * Validates inject() tokens inside useFactory provider definitions at analysis time.
   * Catches invalid or non-determinable tokens before they reach the code generation phase.
   */
  private validateFactoryInjectTokens(): void {
    for (const node of this.modules.values()) {
      for (const [token, ref] of node.providers) {
        const record = this.asRecord(ref.metadata);

        if (record === null || record.useFactory === undefined) {
          continue;
        }

        const factoryRecord = this.asRecord(record.useFactory);

        if (factoryRecord === null) {
          continue;
        }

        const factoryInjects = isAnalyzerValueArray(factoryRecord.__zipbul_factory_injects)
          ? factoryRecord.__zipbul_factory_injects
          : [];

        for (const injectEntry of factoryInjects) {
          const injectRecord = this.asRecord(injectEntry);

          if (injectRecord === null) {
            continue;
          }

          if (injectRecord.tokenKind === 'invalid' || injectRecord.token === null) {
            throw new Error(
              `[Zipbul AOT] inject() token in useFactory of provider '${token}' in module '${node.name}' (${node.filePath}) is not statically determinable.`,
            );
          }
        }
      }
    }
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

  async validateInheritedScopes(): Promise<void> {
    if (!this.gildash) return;

    for (const node of this.modules.values()) {
      for (const provider of node.providers.values()) {
        const sourceScope = provider.scope ?? SCOPE_SINGLETON;
        if (sourceScope !== SCOPE_SINGLETON) continue;

        const classDef = this.classDefinitions.get(provider.token);
        if (!classDef) continue;

        try {
          const chain = await this.gildash.getHeritageChain(provider.token, classDef.filePath);
          this.checkHeritageScopes(chain, provider.token, sourceScope);
        } catch {
          this.warnings.push(
            `[Zipbul AOT] Could not validate inheritance scope for '${provider.token}' in '${classDef.filePath}'. Heritage chain resolution failed.`,
          );
        }
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

      const parentScope = parentProvider.scope ?? SCOPE_SINGLETON;
      if (sourceScope === SCOPE_SINGLETON && parentScope === SCOPE_REQUEST) {
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

    if (targetProvider.visibility === VISIBILITY_ALL) {
      return;
    }

    if (targetProvider.visibility === VISIBILITY_MODULE) {
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
        .map(p => this.extractTokenName(p.type))
        .filter(v => v !== 'UNKNOWN');
    }

    const record = this.asRecord(provider.metadata);

    if (record && isAnalyzerValueArray(record.inject)) {
      return record.inject.map(v => this.extractTokenName(v)).filter(v => v !== 'UNKNOWN');
    }

    return [];
  }

  private normalizeProvider(p: ProviderTokenValue, modulePath: string, moduleName: string): ProviderRef {
    if (isUnresolvable(p)) {
      throw new Error(`[Zipbul AOT] Module '${moduleName}' (${modulePath}): provider must be a class reference or provider object. Found: ${p.nodeType} expression.`);
    }

    let token = 'UNKNOWN';
    const record = this.asRecord(p);
    const options = this.parseInjectableOptions(record ?? undefined, modulePath, moduleName);

    if (record?.provide !== undefined) {
      token = this.extractTokenName(record.provide);
    } else if (typeof p === 'function') {
      token = p.name;
    } else if (record && typeof record[ZIPBUL_REF] === 'string') {
      token = record[ZIPBUL_REF];
      if (this.gildash && typeof record[ZIPBUL_IMPORT_SOURCE] === 'string') {
        try {
          const resolved = this.gildash.resolveSymbol(record[ZIPBUL_REF], record[ZIPBUL_IMPORT_SOURCE]);
          if (!resolved.circular) token = resolved.originalName;
        } catch {
          this.warnings.push(
            `[Zipbul AOT] Symbol resolution failed for '${record[ZIPBUL_REF]}'. Using raw reference name.`,
          );
        }
      }
    }

    if (token === 'UNKNOWN') {
      throw new Error(`[Zipbul AOT] Cannot determine provider token in module '${moduleName}' (${modulePath}). Ensure the provider is a class reference or a valid provider object.`);
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

    if (record && typeof record[ZIPBUL_REF] === 'string') {
      if (this.gildash && typeof record[ZIPBUL_IMPORT_SOURCE] === 'string') {
        try {
          const resolved = this.gildash.resolveSymbol(record[ZIPBUL_REF], record[ZIPBUL_IMPORT_SOURCE]);
          if (!resolved.circular) return resolved.originalName;
        } catch {
          this.warnings.push(
            `[Zipbul AOT] Symbol resolution failed for '${record[ZIPBUL_REF]}'. Using raw reference name.`,
          );
        }
      }
      return record[ZIPBUL_REF];
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

  /**
   * Validates and parses @Injectable decorator arguments (scope, visibleTo) at graph build time.
   * Decorator argument validation (e.g., invalid scope values) is intentionally performed here
   * rather than at AST parse time (ast-parser.ts extractDecorator) because the parser extracts
   * decorator metadata generically without knowledge of specific decorator semantics.
   * @see resolveScope for scope validation
   * @see resolveVisibility for visibleTo validation
   */
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
      if (visibleTo === VISIBILITY_ALL) {
        return { kind: 'all' };
      }

      if (visibleTo === VISIBILITY_MODULE) {
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
      return SCOPE_SINGLETON;
    }

    if (raw === SCOPE_SINGLETON || raw === SCOPE_TRANSIENT) {
      return raw;
    }

    if (raw === SCOPE_REQUEST) {
      return SCOPE_REQUEST;
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

    if (!record || typeof record[ZIPBUL_REF] !== 'string') {
      return null;
    }

    const refName = record[ZIPBUL_REF];
    const importSource = typeof record[ZIPBUL_IMPORT_SOURCE] === 'string' ? record[ZIPBUL_IMPORT_SOURCE] : undefined;
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

  private computeModuleSignature(node: ModuleNode): string {
    const parts: string[] = [node.name];

    const sortedProviders = Array.from(node.providers.entries()).sort(([a], [b]) => compareCodePoint(a, b));

    for (const [token, ref] of sortedProviders) {
      const deps = this.extractDeps(ref).sort(compareCodePoint);
      const metaKind = this.classifyProviderMetadata(ref);
      const factoryCode = this.extractFactoryCode(ref);

      parts.push(`p:${token}|${ref.visibility}|${ref.scope ?? ''}|${deps.join(',')}|${metaKind}|${factoryCode}|${ref.filePath ?? ''}`);
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
      .map(value => JSON.stringify(value))
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

    if (this.isClassMetadata(ref.metadata)) {
      return 'class';
    }

    const record = this.asRecord(ref.metadata);

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

  private extractFactoryCode(ref: ProviderRef): string {
    const record = this.asRecord(ref.metadata ?? undefined);

    if (record === null) {
      return '';
    }

    const factoryRecord = this.asRecord(record.useFactory);

    if (factoryRecord === null) {
      return '';
    }

    const code = factoryRecord[ZIPBUL_FACTORY_CODE];

    return typeof code === 'string' ? code : '';
  }

  private collectReferencedTokens(node: ModuleNode): Set<string> {
    const referenced = new Set<string>();

    for (const provider of node.providers.values()) {
      const deps = this.extractDeps(provider);

      for (const dep of deps) {
        referenced.add(dep);
      }

      const record = this.asRecord(provider.metadata ?? undefined);

      if (record !== null) {
        if (typeof record.useExisting === 'string') {
          referenced.add(record.useExisting);
        }

        const useExistingRecord = this.asRecord(record.useExisting);

        if (useExistingRecord !== null && typeof useExistingRecord[ZIPBUL_REF] === 'string') {
          referenced.add(useExistingRecord[ZIPBUL_REF]);
        }

        this.collectFactoryInjectTokens(record, referenced);
      }
    }

    const injectDeps = this.moduleInjectDeps.get(node.filePath);

    if (injectDeps !== undefined) {
      for (const dep of injectDeps) {
        referenced.add(dep);
      }
    }

    for (const ctrlName of node.controllers) {
      const classDef = this.classDefinitions.get(ctrlName);

      if (classDef === undefined) {
        continue;
      }

      for (const param of classDef.metadata.constructorParams) {
        const tokenName = this.extractTokenName(param.type);

        if (tokenName !== 'UNKNOWN') {
          referenced.add(tokenName);
        }
      }
    }

    return referenced;
  }

  private collectFactoryInjectTokens(record: AnalyzerValueRecord, referenced: Set<string>): void {
    const factoryRecord = this.asRecord(record.useFactory);

    if (factoryRecord === null) {
      return;
    }

    const factoryInjects = isAnalyzerValueArray(factoryRecord.__zipbul_factory_injects)
      ? factoryRecord.__zipbul_factory_injects
      : [];

    for (const entry of factoryInjects) {
      const entryRecord = this.asRecord(entry);

      if (entryRecord === null) {
        continue;
      }

      const tokenName = this.extractTokenName(entryRecord.token);

      if (tokenName !== 'UNKNOWN') {
        referenced.add(tokenName);
      }
    }

    if (isAnalyzerValueArray(record.inject)) {
      for (const token of record.inject) {
        const tokenName = this.extractTokenName(token);

        if (tokenName !== 'UNKNOWN') {
          referenced.add(tokenName);
        }
      }
    }
  }
}
