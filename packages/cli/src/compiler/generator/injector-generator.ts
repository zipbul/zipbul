import type { Result } from '@zipbul/result';
import type { AnalyzerValue } from '../analyzer/types';
import type { ImportRegistry } from './import-registry';
import type { Diagnostic } from '../../diagnostics';

import { err, type Err } from '@zipbul/result';
import {
  ZIPBUL_REF, ZIPBUL_IMPORT_SOURCE, ZIPBUL_CALL,
  ZIPBUL_FACTORY_CODE,
  SCOPED_KEY_SEPARATOR,
  SCOPE_SINGLETON, VISIBILITY_ALL, VISIBILITY_ALLOWLIST, VISIBILITY_MODULE,
} from '@zipbul/common';
import { type ClassMetadata, ModuleGraph, type ModuleNode } from '../analyzer';
import { compareCodePoint } from '../../common';
import { buildDiagnostic } from '../../diagnostics';
import { isAnalyzerValueArray, isNonEmptyString } from '../analyzer/type-guards';
import {
  stableKey, asString, asRecord, getRefName,
  serializeValue, resolveConstructorDeps,
} from './value-serializer';

interface Replacement {
  start: number;
  end: number;
  content: string;
}

const isClassMetadata = (value: AnalyzerValue | ClassMetadata): value is ClassMetadata => {
  const record = asRecord(value);

  if (record === null) {
    return false;
  }

  if (typeof record.className !== 'string') {
    return false;
  }

  if (!Array.isArray(record.constructorParams)) {
    return false;
  }

  if (!Array.isArray(record.decorators)) {
    return false;
  }

  if (!Array.isArray(record.methods)) {
    return false;
  }

  if (!Array.isArray(record.properties)) {
    return false;
  }

  if (record.imports === undefined || typeof record.imports !== 'object') {
    return false;
  }

  return true;
};

export class InjectorGenerator {
  generate(graph: ModuleGraph, registry: ImportRegistry): Result<string, Diagnostic> {
    const allKeys = graph.getAllRegisteredKeys();
    const sortedNodes = Array.from(graph.modules.values()).sort((a, b) => compareCodePoint(a.filePath, b.filePath));

    // Resolve framework imports via the shared registry so the assembled
    // runtime.ts has exactly one `Container` / `runInInjectionContext`
    // import line. Hardcoding `import ... from "@zipbul/core"` in the
    // template used to collide with the metadata path's relative import
    // (Container would appear twice — TS2300 duplicate identifier when
    // tsc is run on the artifact). Resolved before factory generation so
    // every `runInInjectionContext(...)` call site emits the same alias.
    const containerAlias = registry.getAlias('Container', '@zipbul/core');
    const runInjectAlias = registry.getAlias('runInInjectionContext', '@zipbul/core');

    const providerResult = this.generateProviderFactories(sortedNodes, graph, registry, allKeys, runInjectAlias);

    if (!providerResult.ok) {
      return providerResult.error;
    }

    const adapterConfigs = this.generateAdapterConfigs(sortedNodes, registry);
    const dynamicEntries = this.generateDynamicModules(sortedNodes, registry);

    return this.buildContainerCode(
      providerResult.factoryEntries,
      adapterConfigs,
      dynamicEntries,
      containerAlias,
    );
  }

  /**
   * Iterates all modules and their providers to generate DI container factory registration code.
   * Handles useValue, useClass, useExisting, useFactory provider types and plain class providers.
   *
   * @param sortedNodes - Module nodes sorted by file path for deterministic output.
   * @param graph - The module dependency graph containing provider and class definitions.
   * @param registry - The import registry for resolving and tracking import aliases.
   * @param allKeys - Set of all registered scoped keys across all modules.
   * @returns Factory entry code lines, or an error if a factory inject() call cannot be resolved.
   */
  private generateProviderFactories(
    sortedNodes: readonly ModuleNode[],
    graph: ModuleGraph,
    registry: ImportRegistry,
    allKeys: Set<string>,
    runInjectAlias: string,
  ): { ok: true; factoryEntries: string[] } | { ok: false; error: Err<Diagnostic> } {
    const factoryEntries: string[] = [];
    let generateError: Err<Diagnostic> | null = null;

    const getAlias = (name: string, path?: string): string => {
      if (path === undefined || path.length === 0) {
        return name;
      }

      return registry.getAlias(name, path);
    };

    const serializeProviderOptions = (ref: { scope?: string; visibility?: string; visibleTo?: string[] }): string => {
      const scope = ref.scope ?? SCOPE_SINGLETON;
      const visibleTo = ref.visibility === VISIBILITY_ALL ? VISIBILITY_ALL : ref.visibility === VISIBILITY_ALLOWLIST && ref.visibleTo ? JSON.stringify(ref.visibleTo) : VISIBILITY_MODULE;
      const visibleToStr = typeof visibleTo === 'string' ? `'${visibleTo}'` : visibleTo;

      return `{ scope: '${scope}', visibleTo: ${visibleToStr} }`;
    };

    sortedNodes.forEach((node: ModuleNode) => {
      const providerTokens = Array.from(node.providers.keys()).sort(compareCodePoint);

      providerTokens.forEach((token: string) => {
        const ref = node.providers.get(token);

        if (ref === undefined) {
          return;
        }

        const opts = serializeProviderOptions(ref);
        const providerRecord = asRecord(ref.metadata);

        if (providerRecord) {
          if (Object.prototype.hasOwnProperty.call(providerRecord, 'useValue')) {
            const val = serializeValue(providerRecord.useValue, registry);

            factoryEntries.push(`  container.set('${node.name}${SCOPED_KEY_SEPARATOR}${token}', () => ${val}, ${opts});`);

            return;
          }

          if (providerRecord.useClass !== undefined) {
            const useClass = providerRecord.useClass;
            const classes = Array.isArray(useClass) ? useClass : [useClass];
            const instances = classes.map((clsItem: AnalyzerValue) => {
              const className = getRefName(clsItem);

              if (className === null || className.length === 0) {
                throw new Error(`[Zipbul AOT] useClass reference in provider '${token}' of module '${node.name}' could not be resolved. Ensure the class is a valid class reference.`);
              }

              const clsDef = graph.classDefinitions.get(className);

              if (clsDef === undefined) {
                throw new Error(`[Zipbul AOT] useClass '${className}' in provider '${token}' of module '${node.name}' is not found in any module. Ensure the class exists and belongs to a module.`);
              }

              const alias = getAlias(clsDef.metadata.className, clsDef.filePath);
              const deps = resolveConstructorDeps(clsDef.metadata, node, graph, allKeys);

              return `new ${alias}(${deps.join(', ')})`;
            });
            const factoryBody = Array.isArray(useClass) ? `[${instances.join(', ')}]` : instances[0];

            factoryEntries.push(`  container.set('${node.name}${SCOPED_KEY_SEPARATOR}${token}', (c) => ${runInjectAlias}(c, () => ${factoryBody}), ${opts});`);

            return;
          }

          if (providerRecord.useExisting !== undefined) {
            const existingToken = serializeValue(providerRecord.useExisting, registry);

            // A-4: Validate useExisting target exists (class-based tokens only)
            const existingRefName = getRefName(providerRecord.useExisting);

            if (isNonEmptyString(existingRefName) && graph.classDefinitions.has(existingRefName)) {
              const existingTargetModule = graph.classMap.get(existingRefName);
              const existingScopedKey = existingTargetModule
                ? `${existingTargetModule.name}${SCOPED_KEY_SEPARATOR}${existingRefName}`
                : existingRefName;

              if (!allKeys.has(existingScopedKey)) {
                throw new Error(`[Zipbul AOT] useExisting target '${existingRefName}' in provider '${token}' of module '${node.name}' is not registered in any module.`);
              }
            }

            factoryEntries.push(`  container.set('${node.name}${SCOPED_KEY_SEPARATOR}${token}', (c) => c.get(${existingToken}), ${opts});`);

            return;
          }

          if (providerRecord.useFactory !== undefined) {
            const factoryRecord = asRecord(providerRecord.useFactory);
            let factoryFn = typeof factoryRecord?.[ZIPBUL_FACTORY_CODE] === 'string' ? factoryRecord[ZIPBUL_FACTORY_CODE] : '';
            const deps =
              factoryRecord && isAnalyzerValueArray(factoryRecord.__zipbul_factory_deps)
                ? factoryRecord.__zipbul_factory_deps
                : [];

            if (factoryFn.length === 0) {
              throw new Error(`[Zipbul AOT] useFactory code for provider '${token}' in module '${node.name}' could not be extracted. Ensure the factory is a statically analyzable function expression.`);
            }

            const replacements: Replacement[] = [];
            const orderedDeps = [...deps].sort((a, b) => {
              const left = asRecord(a);
              const right = asRecord(b);
              const leftName = typeof left?.name === 'string' ? left.name : '';
              const rightName = typeof right?.name === 'string' ? right.name : '';
              const nameDiff = compareCodePoint(leftName, rightName);

              if (nameDiff !== 0) {
                return nameDiff;
              }

              const leftPath = typeof left?.path === 'string' ? left.path : '';
              const rightPath = typeof right?.path === 'string' ? right.path : '';
              const pathDiff = compareCodePoint(leftPath, rightPath);

              if (pathDiff !== 0) {
                return pathDiff;
              }

              const leftStart = typeof left?.start === 'number' ? left.start : 0;
              const rightStart = typeof right?.start === 'number' ? right.start : 0;
              const startDiff = leftStart - rightStart;

              if (startDiff !== 0) {
                return startDiff;
              }

              const leftEnd = typeof left?.end === 'number' ? left.end : 0;
              const rightEnd = typeof right?.end === 'number' ? right.end : 0;

              return leftEnd - rightEnd;
            });

            orderedDeps.forEach(dep => {
              const depRecord = asRecord(dep);

              if (depRecord === null) {
                return;
              }

              const name = typeof depRecord.name === 'string' ? depRecord.name : null;
              const path = typeof depRecord.path === 'string' ? depRecord.path : null;
              const start = typeof depRecord.start === 'number' ? depRecord.start : null;
              const end = typeof depRecord.end === 'number' ? depRecord.end : null;

              if (name === null || name.length === 0 || path === null || path.length === 0 || start === null || end === null) {
                return;
              }

              const alias = registry.getAlias(name, path);

              if (alias !== name) {
                replacements.push({ start, end, content: alias });
              }
            });

            const injectCalls =
              factoryRecord && isAnalyzerValueArray(factoryRecord.__zipbul_factory_injects)
                ? factoryRecord.__zipbul_factory_injects
                : [];

            injectCalls.forEach(injectEntry => {
              if (generateError !== null) {
                return;
              }

              const injectRecord = asRecord(injectEntry);

              if (!injectRecord) {
                return;
              }

              const start = typeof injectRecord.start === 'number' ? injectRecord.start : null;
              const end = typeof injectRecord.end === 'number' ? injectRecord.end : null;
              const tokenKind = injectRecord.tokenKind;
              const tokenValue = injectRecord.token;

              if (start === null || end === null || tokenKind === 'invalid' || tokenValue === null) {
                generateError = err(buildDiagnostic({
                  reason: 'Cannot statically determine the token for this inject() call.',
                }));

                return;
              }

              const tokenName = getRefName(tokenValue);

              if (!isNonEmptyString(tokenName)) {
                generateError = err(buildDiagnostic({
                  reason: 'Cannot statically determine the token for this inject() call.',
                }));

                return;
              }

              const resolvedToken = graph.resolveToken(node.name, tokenName);
              const targetModule = graph.classMap.get(tokenName);
              const resolvedKey = isNonEmptyString(resolvedToken)
                ? resolvedToken
                : targetModule
                  ? `${targetModule.name}${SCOPED_KEY_SEPARATOR}${tokenName}`
                  : tokenName;

              // A-5: Validate factory inject() token exists (class-based tokens only)
              if (graph.classDefinitions.has(tokenName) && !allKeys.has(resolvedKey)) {
                throw new Error(`[Zipbul AOT] inject() token '${tokenName}' in useFactory of provider '${token}' in module '${node.name}' is not registered in any module.`);
              }

              replacements.push({ start, end, content: `c.get('${resolvedKey}')` });
            });

            if (generateError !== null) {
              return;
            }

            replacements
              .sort((a, b) => b.start - a.start)
              .forEach(rep => {
                factoryFn = factoryFn.slice(0, rep.start) + rep.content + factoryFn.slice(rep.end);
              });

            const injectList = Array.isArray(providerRecord.inject) ? providerRecord.inject : [];
            const injectedArgs = injectList.map((injectItem: AnalyzerValue) => {
              const tokenName = getRefName(injectItem);

              if (tokenName === null || tokenName.length === 0) {
                throw new Error(`[Zipbul AOT] inject token in useFactory 'inject' list for provider '${token}' of module '${node.name}' could not be resolved. Ensure all inject tokens are valid class references or string tokens.`);
              }

              const resolved = graph.resolveToken(node.name, tokenName) ?? tokenName;

              // A-5: Validate inject list token exists (class-based tokens only)
              if (graph.classDefinitions.has(tokenName)) {
                const targetModule = graph.classMap.get(tokenName);
                const scopedKey = targetModule
                  ? `${targetModule.name}${SCOPED_KEY_SEPARATOR}${tokenName}`
                  : tokenName;

                if (!allKeys.has(scopedKey) && !allKeys.has(resolved)) {
                  throw new Error(`[Zipbul AOT] inject() token '${tokenName}' in useFactory 'inject' list of provider '${token}' in module '${node.name}' is not registered in any module.`);
                }
              }

              return `c.get('${resolved}')`;
            });

            factoryEntries.push(`  container.set('${node.name}${SCOPED_KEY_SEPARATOR}${token}', (c) => {`);
            factoryEntries.push(`    const factory = ${factoryFn};`);
            factoryEntries.push(`    return factory(${injectedArgs.join(', ')});`);
            factoryEntries.push(`  }, ${opts});`);

            return;
          }
        }

        if (isClassMetadata(ref.metadata)) {
          const clsMeta = ref.metadata;
          const alias = getAlias(clsMeta.className, ref.filePath);
          const deps = resolveConstructorDeps(clsMeta, node, graph, allKeys);

          factoryEntries.push(`  container.set('${node.name}${SCOPED_KEY_SEPARATOR}${token}', (c) => ${runInjectAlias}(c, () => new ${alias}(${deps.join(', ')})), ${opts});`);
        }
      });
    });

    if (generateError !== null) {
      return { ok: false, error: generateError };
    }

    return { ok: true, factoryEntries };
  }

  /**
   * Collects adapter configuration entries (middlewares, exception filters, guards) from all modules
   * and serializes them into code lines for the generated adapter config object.
   *
   * @param sortedNodes - Module nodes sorted by file path for deterministic output.
   * @param registry - The import registry for resolving and tracking import aliases.
   * @returns Serialized adapter config code lines.
   */
  private generateAdapterConfigs(sortedNodes: readonly ModuleNode[], registry: ImportRegistry): string[] {
    const adapterConfigMap = new Map<
      string,
      {
        middlewareList: string[];
        middlewares: Map<string, string[]>;
        exceptionFilters: string[];
        guards: string[];
      }
    >();

    sortedNodes.forEach((node: ModuleNode) => {
      if (node.moduleDefinition?.adapters === undefined) {
        return;
      }

      const adaptersArray = Array.isArray(node.moduleDefinition.adapters) ? node.moduleDefinition.adapters : null;

      if (adaptersArray === null) {
        return;
      }

      for (const item of adaptersArray) {
        const itemRecord = asRecord(item);

        if (itemRecord === null) {
          continue;
        }

        const adapterRef = asRecord(itemRecord.adapter);
        const adapterClassName = typeof adapterRef?.[ZIPBUL_REF] === 'string' ? adapterRef[ZIPBUL_REF] : null;
        const nameValue = typeof itemRecord.name === 'string' ? itemRecord.name : null;
        const configKey = nameValue ?? adapterClassName;

        if (configKey === null || configKey.length === 0) {
          continue;
        }

        const adapterConfigEntry = adapterConfigMap.get(configKey) ?? {
          middlewareList: [],
          middlewares: new Map<string, string[]>(),
          exceptionFilters: [],
          guards: [],
        };

        if (itemRecord.middlewares !== undefined) {
          const middlewares = asRecord(itemRecord.middlewares);

          if (middlewares !== null) {
            for (const phase of Object.keys(middlewares).sort(compareCodePoint)) {
              const values = Array.isArray(middlewares[phase]) ? middlewares[phase] : null;

              if (values === null) {
                continue;
              }

              const existing = adapterConfigEntry.middlewares.get(phase) ?? [];
              const serializedValues = values.map(value => serializeValue(value, registry));

              adapterConfigEntry.middlewares.set(phase, [...existing, ...serializedValues]);
            }
          } else if (Array.isArray(itemRecord.middlewares)) {
            adapterConfigEntry.middlewareList.push(
              ...itemRecord.middlewares.map(value => serializeValue(value, registry)),
            );
          }
        }

        if (itemRecord.exceptionFilters !== undefined) {
          const exceptionFilters = Array.isArray(itemRecord.exceptionFilters) ? itemRecord.exceptionFilters : null;

          if (exceptionFilters !== null) {
            adapterConfigEntry.exceptionFilters.push(
              ...exceptionFilters.map(value => serializeValue(value, registry)),
            );
          }
        }

        if (itemRecord.guards !== undefined) {
          const guards = Array.isArray(itemRecord.guards) ? itemRecord.guards : null;

          if (guards !== null) {
            adapterConfigEntry.guards.push(
              ...guards.map(value => serializeValue(value, registry)),
            );
          }
        }

        adapterConfigMap.set(configKey, adapterConfigEntry);
      }
    });

    return [...adapterConfigMap.entries()]
      .sort(([left], [right]) => compareCodePoint(left, right))
      .flatMap(([configKey, config]) => {
        const configParts: string[] = [];

        if (config.middlewares.size > 0) {
          const phaseEntries = [...config.middlewares.entries()]
            .sort(([left], [right]) => compareCodePoint(left, right))
            .map(([phase, values]) => `'${phase}': [${values.join(', ')}]`);

          configParts.push(`'middlewares': { ${phaseEntries.join(', ')} }`);
        } else if (config.middlewareList.length > 0) {
          configParts.push(`'middlewares': [${config.middlewareList.join(', ')}]`);
        }

        if (config.exceptionFilters.length > 0) {
          configParts.push(`'exceptionFilters': [${config.exceptionFilters.join(', ')}]`);
        }

        if (config.guards.length > 0) {
          configParts.push(`'guards': [${config.guards.join(', ')}]`);
        }

        if (configParts.length === 0) {
          return [];
        }

        return [`  '${configKey}': { ${configParts.join(', ')} },`];
      });
  }

  /**
   * Generates dynamic module registration code by iterating all modules and their dynamic imports.
   * Each dynamic import produces an await call and a container.loadDynamicModule registration.
   *
   * @param sortedNodes - Module nodes sorted by file path for deterministic output.
   * @param registry - The import registry for resolving and tracking import aliases.
   * @returns Dynamic module registration code lines.
   */
  private generateDynamicModules(sortedNodes: readonly ModuleNode[], registry: ImportRegistry): string[] {
    const dynamicEntries: string[] = [];

    sortedNodes.forEach((node: ModuleNode) => {
      const dynamicImports = Array.from(node.dynamicImports).sort((a, b) => compareCodePoint(stableKey(a), stableKey(b)));

      dynamicImports.forEach(imp => {
        const impRecord = asRecord(imp);

        if (impRecord === null || typeof impRecord[ZIPBUL_CALL] !== 'string') {
          return;
        }

        const parts = impRecord[ZIPBUL_CALL].split('.');
        const className = parts[0];
        const methodName = parts[1];

        if (className === undefined || className.length === 0) {
          return;
        }

        let callExpression = impRecord[ZIPBUL_CALL];
        const importSource = asString(impRecord[ZIPBUL_IMPORT_SOURCE]);

        if (importSource === undefined) {
          return;
        }

        {
          const alias = registry.getAlias(className, importSource);

          if (isNonEmptyString(methodName)) {
            callExpression = `${alias}.${methodName}`;
          } else {
            callExpression = alias;
          }
        }

        const argList = isAnalyzerValueArray(impRecord.args) ? impRecord.args : [];
        const args = argList.map(a => serializeValue(a, registry)).join(', ');

        dynamicEntries.push(`  const mod_${node.name}_${className} = await ${callExpression}(${args});`);
        dynamicEntries.push(`  await container.loadDynamicModule('${className}', mod_${node.name}_${className});`);
      });
    });

    return dynamicEntries;
  }

  /**
   * Assembles the final generated container code string from the pre-built sections.
   *
   * @param factoryEntries - Container provider factory registration lines.
   * @param adapterConfigs - Adapter configuration object property lines.
   * @param dynamicEntries - Dynamic module registration lines.
   * @returns The complete generated injector source code.
   */
  private buildContainerCode(
    factoryEntries: string[],
    adapterConfigs: string[],
    dynamicEntries: string[],
    containerAlias: string,
  ): Result<string, Diagnostic> {
    return `
export function createContainer() {
  const container = new ${containerAlias}();
${factoryEntries.join('\n')}
  return container;
}

export const adapterConfig = deepFreeze({
${adapterConfigs.join('\n')}
});

export async function registerDynamicModules(container: { loadDynamicModule: (name: string, module: unknown) => Promise<void> }) {
${dynamicEntries.join('\n')}
}
`;
  }

  /**
   * Serializes an analyzer value to generated code string.
   * Used by ManifestGenerator for route-level pipeline registrations.
   *
   * @param value - The analyzer value (identifier reference, literal, etc.)
   * @param registry - The import registry for tracking required imports.
   * @returns Generated code string.
   */
  serializeValuePublic(value: AnalyzerValue, registry: ImportRegistry): string {
    return serializeValue(value, registry);
  }
}
