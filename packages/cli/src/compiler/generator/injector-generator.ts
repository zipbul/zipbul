import type { Result } from '@zipbul/result';
import type { AnalyzerValue, AnalyzerValueRecord } from '../analyzer/types';
import type { ImportRegistry } from './import-registry';
import type { Diagnostic } from '../../diagnostics';

import { err, type Err } from '@zipbul/result';
import { type ClassMetadata, ModuleGraph, type ModuleNode } from '../analyzer';
import { compareCodePoint } from '../../common';
import { buildDiagnostic } from '../../diagnostics';

type RecordValue = AnalyzerValueRecord;

interface Replacement {
  start: number;
  end: number;
  content: string;
}

type GeneratorValue = AnalyzerValue | symbol | ((...args: readonly AnalyzerValue[]) => AnalyzerValue);

const isAnalyzerValueArray = (value: AnalyzerValue): value is AnalyzerValue[] => {
  return Array.isArray(value);
};

const isRecordValue = (value: GeneratorValue | ClassMetadata): value is AnalyzerValueRecord => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

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
    const parts = value.map(v => stableKey(v, visited));

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
  const entries = Object.entries(record).sort(([a], [b]) => compareCodePoint(a, b));
  const parts = entries.map(([k, v]) => `${k}:${stableKey(v, visited)}`);

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

  if (typeof record.__zipbul_ref === 'string') {
    return record.__zipbul_ref;
  }

  return null;
};

const getForwardRefName = (value: AnalyzerValue): string | null => {
  const record = asRecord(value);

  if (record === null) {
    return null;
  }

  if (typeof record.__zipbul_forward_ref === 'string') {
    return record.__zipbul_forward_ref;
  }

  return null;
};

const isNonEmptyString = (value: string | null | undefined): value is string => {
  return typeof value === 'string' && value.length > 0;
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

    const sortedNodes = Array.from(graph.modules.values()).sort((a, b) => compareCodePoint(a.filePath, b.filePath));

    sortedNodes.forEach((node: ModuleNode) => {
      const providerTokens = Array.from(node.providers.keys()).sort(compareCodePoint);

      providerTokens.forEach((token: string) => {
        const ref = node.providers.get(token);

        if (ref === undefined) {
          return;
        }

        const providerRecord = asRecord(ref.metadata);

        if (providerRecord) {
          if (Object.prototype.hasOwnProperty.call(providerRecord, 'useValue')) {
            const val = this.serializeValue(providerRecord.useValue, registry);

            factoryEntries.push(`  container.set('${node.name}::${token}', () => ${val});`);

            return;
          }

          if (providerRecord.useClass !== undefined) {
            const useClass = providerRecord.useClass;
            const classes = Array.isArray(useClass) ? useClass : [useClass];
            const instances = classes.map((clsItem: AnalyzerValue) => {
              const className = getRefName(clsItem);

              if (className === null || className.length === 0) {
                return 'undefined';
              }

              const clsDef = graph.classDefinitions.get(className);

              if (clsDef === undefined) {
                return 'undefined';
              }

              const alias = getAlias(clsDef.metadata.className, clsDef.filePath);
              const deps = this.resolveConstructorDeps(clsDef.metadata, node, graph);

              return `new ${alias}(${deps.join(', ')})`;
            });
            const factoryBody = Array.isArray(useClass) ? `[${instances.join(', ')}]` : instances[0];

            factoryEntries.push(`  container.set('${node.name}::${token}', (c) => ${factoryBody});`);

            return;
          }

          if (providerRecord.useExisting !== undefined) {
            const existingToken = this.serializeValue(providerRecord.useExisting, registry);

            factoryEntries.push(`  container.set('${node.name}::${token}', (c) => c.get(${existingToken}));`);

            return;
          }

          if (providerRecord.useFactory !== undefined) {
            const factoryRecord = asRecord(providerRecord.useFactory as AnalyzerValue);
            let factoryFn = typeof factoryRecord?.__zipbul_factory_code === 'string' ? factoryRecord.__zipbul_factory_code : '';
            const deps =
              factoryRecord && isAnalyzerValueArray(factoryRecord.__zipbul_factory_deps)
                ? factoryRecord.__zipbul_factory_deps
                : [];

            if (factoryFn.length === 0) {
              return;
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
                  reason: 'inject() 호출의 토큰을 정적으로 결정할 수 없습니다.',
                }));

                return;
              }

              const tokenName = getRefName(tokenValue);

              if (!isNonEmptyString(tokenName)) {
                generateError = err(buildDiagnostic({
                  reason: 'inject() 호출의 토큰을 정적으로 결정할 수 없습니다.',
                }));

                return;
              }

              const resolvedToken = graph.resolveToken(node.name, tokenName);
              const targetModule = graph.classMap.get(tokenName);
              const resolvedKey = isNonEmptyString(resolvedToken)
                ? resolvedToken
                : targetModule
                  ? `${targetModule.name}::${tokenName}`
                  : tokenName;

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
                return 'undefined';
              }

              const resolved = graph.resolveToken(node.name, tokenName) ?? tokenName;

              return `c.get('${resolved}')`;
            });

            factoryEntries.push(`  container.set('${node.name}::${token}', (c) => {`);
            factoryEntries.push(`    const factory = ${factoryFn};`);
            factoryEntries.push(`    return factory(${injectedArgs.join(', ')});`);
            factoryEntries.push('  });');

            return;
          }
        }

        if (isClassMetadata(ref.metadata)) {
          const clsMeta = ref.metadata;
          const alias = getAlias(clsMeta.className, ref.filePath);
          const deps = this.resolveConstructorDeps(clsMeta, node, graph);

          factoryEntries.push(`  container.set('${node.name}::${token}', (c) => new ${alias}(${deps.join(', ')}));`);
        }
      });

      const dynamicBundles = Array.from(node.dynamicProviderBundles).sort((a, b) => compareCodePoint(stableKey(a), stableKey(b)));

      dynamicBundles.forEach(bundle => {
        const stable = this.serializeValue(bundle, registry);

        factoryEntries.push(`  (${stable} || []).forEach(p => {`);
        factoryEntries.push('    let token = p.provide;');
        factoryEntries.push("    if (typeof p === 'function') token = p.name;");
        factoryEntries.push('');
        factoryEntries.push('    let factory;');
        factoryEntries.push("    if (Object.prototype.hasOwnProperty.call(p, 'useValue')) factory = () => p.useValue;");
        factoryEntries.push('    else if (p.useClass) factory = () => new p.useClass();');
        factoryEntries.push('    else if (p.useFactory) {');
        factoryEntries.push('      factory = (c) => {');
        factoryEntries.push('        const args = (p.inject || []).map(t => c.get(t));');
        factoryEntries.push('        return p.useFactory(...args);');
        factoryEntries.push('      };');
        factoryEntries.push('    }');
        factoryEntries.push('');
        factoryEntries.push(
          `    const key = token ? '${node.name}::' + (typeof token === 'symbol' ? token.description : token) : null;`,
        );
        factoryEntries.push('    if (key && factory) container.set(key, factory);');
        factoryEntries.push('  });');
      });

      if (node.moduleDefinition?.adapters !== undefined) {
        const config = this.serializeValue(node.moduleDefinition.adapters, registry);

        adapterConfigs.push(`  '${node.name}': ${config},`);
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

        if (impRecord === null || typeof impRecord.__zipbul_call !== 'string') {
          return;
        }

        const parts = impRecord.__zipbul_call.split('.');
        const className = parts[0];
        const methodName = parts[1];

        if (className === undefined || className.length === 0) {
          return;
        }

        let callExpression = impRecord.__zipbul_call;
        const importSource = asString(impRecord.__zipbul_import_source);

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

    if (typeof record.__zipbul_ref === 'string' && typeof record.__zipbul_import_source === 'string') {
      return registry.getAlias(record.__zipbul_ref, record.__zipbul_import_source);
    }

    if (typeof record.__zipbul_call === 'string') {
      const parts = record.__zipbul_call.split('.');
      const className = parts[0];
      const methodName = parts[1];

      if (className === undefined || className.length === 0) {
        return 'undefined';
      }

      let callName = record.__zipbul_call;
      const importSource = asString(record.__zipbul_import_source);

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
      if (key.startsWith('__zipbul_computed_')) {
        const computed = asRecord(entryValue) ?? {};
        const keyContent = this.serializeValue(computed.__zipbul_computed_key, registry);
        const valContent = this.serializeValue(computed.__zipbul_computed_value, registry);

        return `[${keyContent}]: ${valContent}`;
      }

      return `'${key}': ${this.serializeValue(entryValue, registry)}`;
    });

    return `{ ${props.join(', ')} }`;
  }

  private resolveConstructorDeps(meta: ClassMetadata, node: ModuleNode, graph: ModuleGraph): string[] {
    return meta.constructorParams.map(param => {
      let token: AnalyzerValue = param.type;
      const refName = getRefName(token);
      const forwardRefName = getForwardRefName(token);

      if (isNonEmptyString(refName)) {
        token = refName;
      } else if (isNonEmptyString(forwardRefName)) {
        token = forwardRefName;
      }

      const injectDec = param.decorators.find(d => d.name === 'Inject');
      const injectArgs = injectDec?.arguments;

      if (Array.isArray(injectArgs) && injectArgs.length > 0) {
        const arg = injectArgs[0];

        if (typeof arg === 'string') {
          token = arg;
        } else {
          const argRefName = getRefName(arg);
          const argForwardRefName = getForwardRefName(arg);

          if (isNonEmptyString(argRefName)) {
            token = argRefName;
          } else if (isNonEmptyString(argForwardRefName)) {
            token = argForwardRefName;
          }
        }
      }

      if (typeof token !== 'string') {
        return 'undefined';
      }

      const resolvedToken = graph.resolveToken(node.name, token);

      if (isNonEmptyString(resolvedToken)) {
        return `c.get('${resolvedToken}')`;
      }

      const targetModule = graph.classMap.get(token);

      if (targetModule) {
        return `c.get('${targetModule.name}::${token}')`;
      }

      return `c.get('${token}')`;
    });
  }
}
