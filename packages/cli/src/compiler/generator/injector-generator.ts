import type { Result } from '@zipbul/result';
import type { AnalyzerValue, AnalyzerValueRecord } from '../analyzer/types';
import type { ImportRegistry } from './import-registry';
import type { Diagnostic } from '../../diagnostics';

import { err, type Err } from '@zipbul/result';
import {
  ZIPBUL_REF, ZIPBUL_LAZY_REF, ZIPBUL_IMPORT_SOURCE, ZIPBUL_CALL,
  ZIPBUL_FACTORY_CODE, ZIPBUL_COMPUTED_PREFIX, ZIPBUL_COMPUTED_KEY, ZIPBUL_COMPUTED_VALUE,
  SCOPED_KEY_SEPARATOR,
  SCOPE_SINGLETON, VISIBILITY_ALL, VISIBILITY_ALLOWLIST, VISIBILITY_MODULE,
} from '@zipbul/common';
import { type ClassMetadata, ModuleGraph, type ModuleNode } from '../analyzer';
import { compareCodePoint } from '../../common';
import { buildDiagnostic } from '../../diagnostics';
import { isRecordValue, isAnalyzerValueArray, isNonEmptyString, isUnresolvable } from '../analyzer/type-guards';
import { Logger } from '@zipbul/logger';

const logger = new Logger('InjectorGenerator');

type RecordValue = AnalyzerValueRecord;

interface Replacement {
  start: number;
  end: number;
  content: string;
}

type GeneratorValue = AnalyzerValue | symbol | ((...args: readonly AnalyzerValue[]) => AnalyzerValue);

const stableKey = (value: GeneratorValue, visited = new WeakSet<AnalyzerValueRecord>()): string => {
  if (value === null) {
    return 'null';
  }

  if (value === undefined) {
    return 'undefined';
  }

  if (typeof value === 'string') {
    return `string:${value}`;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return `${typeof value}:${String(value)}`;
  }

  if (typeof value === 'symbol') {
    return `symbol:${value.description ?? value.toString()}`;
  }

  if (typeof value === 'function') {
    return `function:${value.name}`;
  }

  if (isAnalyzerValueArray(value)) {
    const parts = value.map(val => stableKey(val, visited));

    return `[${parts.join(',')}]`;
  }

  if (typeof value !== 'object' || value === null) {
    return 'unknown';
  }

  if (!isRecordValue(value)) {
    return 'unknown';
  }

  if (visited.has(value)) {
    return '[Circular]';
  }

  visited.add(value);

  const record: AnalyzerValueRecord = value;
  const entries = Object.entries(record).sort(([keyA], [keyB]) => compareCodePoint(keyA, keyB));
  const parts = entries.map(([key, val]) => `${key}:${stableKey(val, visited)}`);

  return `{${parts.join(',')}}`;
};

const asString = (value: AnalyzerValue): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  return value;
};

const asRecord = (value: GeneratorValue | ClassMetadata): RecordValue | null => {
  if (!isRecordValue(value)) {
    return null;
  }

  return value;
};

const getRefName = (value: AnalyzerValue): string | null => {
  if (typeof value === 'string') {
    return value;
  }

  const record = asRecord(value);

  if (record === null) {
    return null;
  }

  if (typeof record[ZIPBUL_REF] === 'string') {
    return record[ZIPBUL_REF];
  }

  return null;
};

const getLazyRefName = (value: AnalyzerValue): string | null => {
  const record = asRecord(value);

  if (record === null) {
    return null;
  }

  if (typeof record[ZIPBUL_LAZY_REF] === 'string') {
    return record[ZIPBUL_LAZY_REF];
  }

  return null;
};

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
    const factoryEntries: string[] = [];
    const adapterConfigs: string[] = [];
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

    const allKeys = graph.getAllRegisteredKeys();

    const sortedNodes = Array.from(graph.modules.values()).sort((a, b) => compareCodePoint(a.filePath, b.filePath));

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
            const val = this.serializeValue(providerRecord.useValue, registry);

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
              const deps = this.resolveConstructorDeps(clsDef.metadata, node, graph, allKeys);

              return `new ${alias}(${deps.join(', ')})`;
            });
            const factoryBody = Array.isArray(useClass) ? `[${instances.join(', ')}]` : instances[0];

            factoryEntries.push(`  container.set('${node.name}${SCOPED_KEY_SEPARATOR}${token}', (c) => runInInjectionContext(c, () => ${factoryBody}), ${opts});`);

            return;
          }

          if (providerRecord.useExisting !== undefined) {
            const existingToken = this.serializeValue(providerRecord.useExisting, registry);

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
          const deps = this.resolveConstructorDeps(clsMeta, node, graph, allKeys);

          factoryEntries.push(`  container.set('${node.name}${SCOPED_KEY_SEPARATOR}${token}', (c) => runInInjectionContext(c, () => new ${alias}(${deps.join(', ')})), ${opts});`);
        }
      });

      if (node.moduleDefinition?.adapters !== undefined) {
        const adaptersArray = Array.isArray(node.moduleDefinition.adapters) ? node.moduleDefinition.adapters : null;

        if (adaptersArray !== null) {
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

            const configParts: string[] = [];

            if (itemRecord.middlewares !== undefined) {
              configParts.push(`'middlewares': ${this.serializeValue(itemRecord.middlewares, registry)}`);
            }

            if (itemRecord.exceptionFilters !== undefined) {
              configParts.push(`'exceptionFilters': ${this.serializeValue(itemRecord.exceptionFilters, registry)}`);
            }

            if (itemRecord.guards !== undefined) {
              configParts.push(`'guards': ${this.serializeValue(itemRecord.guards, registry)}`);
            }

            if (configParts.length > 0) {
              adapterConfigs.push(`  '${configKey}': { ${configParts.join(', ')} },`);
            }
          }
        }
      }
    });

    if (generateError !== null) {
      return generateError;
    }

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
        const args = argList.map(a => this.serializeValue(a, registry)).join(', ');

        dynamicEntries.push(`  const mod_${node.name}_${className} = await ${callExpression}(${args});`);
        dynamicEntries.push(`  await container.loadDynamicModule('${className}', mod_${node.name}_${className});`);
      });
    });

    return `
import { Container } from "@zipbul/core";
import { runInInjectionContext } from "@zipbul/core";

export function createContainer() {
  const container = new Container();
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
    return this.serializeValue(value, registry);
  }

  private serializeValue(value: AnalyzerValue, registry: ImportRegistry): string {
    if (value === undefined) {
      return 'undefined';
    }

    if (value === null) {
      return 'null';
    }

    if (typeof value === 'string') {
      return JSON.stringify(value);
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    if (isAnalyzerValueArray(value)) {
      return `[${value.map(v => this.serializeValue(v, registry)).join(', ')}]`;
    }

    const record = asRecord(value);

    if (record === null) {
      return 'undefined';
    }

    if (typeof record[ZIPBUL_REF] === 'string' && typeof record[ZIPBUL_IMPORT_SOURCE] === 'string') {
      return registry.getAlias(record[ZIPBUL_REF], record[ZIPBUL_IMPORT_SOURCE]);
    }

    if (typeof record[ZIPBUL_CALL] === 'string') {
      const parts = record[ZIPBUL_CALL].split('.');
      const className = parts[0];
      const methodName = parts[1];

      if (className === undefined || className.length === 0) {
        return 'undefined';
      }

      let callName = record[ZIPBUL_CALL];
      const importSource = asString(record[ZIPBUL_IMPORT_SOURCE]);

      if (importSource !== undefined) {
        const alias = registry.getAlias(className, importSource);

        if (isNonEmptyString(methodName)) {
          callName = `${alias}.${methodName}`;
        } else {
          callName = alias;
        }
      }

      const args = (isAnalyzerValueArray(record.args) ? record.args : []).map(a => this.serializeValue(a, registry)).join(', ');

      return `${callName}(${args})`;
    }

    const entries = Object.entries(record).sort(([a], [b]) => compareCodePoint(a, b));
    const props = entries.map(([key, entryValue]) => {
      if (key.startsWith(ZIPBUL_COMPUTED_PREFIX)) {
        const computed = asRecord(entryValue) ?? {};
        const keyContent = this.serializeValue(computed[ZIPBUL_COMPUTED_KEY], registry);
        const valContent = this.serializeValue(computed[ZIPBUL_COMPUTED_VALUE], registry);

        return `[${keyContent}]: ${valContent}`;
      }

      return `'${key}': ${this.serializeValue(entryValue, registry)}`;
    });

    return `{ ${props.join(', ')} }`;
  }

  private resolveConstructorDeps(meta: ClassMetadata, node: ModuleNode, graph: ModuleGraph, allKeys: Set<string>): string[] {
    return meta.constructorParams.map(param => {
      let token: AnalyzerValue = param.type;

      if (isUnresolvable(token)) {
        throw new Error(`[Zipbul AOT] Constructor parameter '${param.name}' of '${meta.className}': dependency type must be a statically resolvable class reference. Found: ${token.nodeType} expression.`);
      }

      const refName = getRefName(token);
      const lazyRefName = getLazyRefName(token);

      if (isNonEmptyString(refName)) {
        token = refName;
      } else if (isNonEmptyString(lazyRefName)) {
        token = lazyRefName;
      }

      if (typeof token !== 'string') {
        throw new Error(`[Zipbul AOT] Constructor parameter '${param.name}' of '${meta.className}': dependency type cannot be statically determined. Ensure the parameter has an explicit class type annotation.`);
      }

      const resolvedToken = graph.resolveToken(node.name, token);

      if (isNonEmptyString(resolvedToken)) {
        // A-1/H-2: Validate constructor dep token exists (class-based tokens only)
        if (graph.classDefinitions.has(token) && !allKeys.has(resolvedToken)) {
          throw new Error(`[Zipbul AOT] inject() token '${token}' in '${meta.className}' is not registered in any module.`);
        }

        return `c.get('${resolvedToken}')`;
      }

      const targetModule = graph.classMap.get(token);

      if (targetModule) {
        const scopedKey = `${targetModule.name}${SCOPED_KEY_SEPARATOR}${token}`;

        // A-1/H-2: Validate constructor dep token exists (class-based tokens only)
        if (graph.classDefinitions.has(token) && !allKeys.has(scopedKey)) {
          throw new Error(`[Zipbul AOT] inject() token '${token}' in '${meta.className}' is not registered in any module.`);
        }

        return `c.get('${scopedKey}')`;
      }

      // A-1/H-2: Validate bare token if it's a known class reference
      if (graph.classDefinitions.has(token) && !allKeys.has(token)) {
        throw new Error(`[Zipbul AOT] inject() token '${token}' in '${meta.className}' is not registered in any module.`);
      }

      return `c.get('${token}')`;
    });
  }
}
