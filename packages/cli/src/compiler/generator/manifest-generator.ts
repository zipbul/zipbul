import { dirname, relative } from 'path';

import type { Result } from '@zipbul/result';
import type { AnalyzerValue, AnalyzerValueRecord } from '../analyzer/types';
import type { Diagnostic } from '../../diagnostics/types';
import type {
  ManifestDiNode,
  ManifestJsonModel,
  ManifestJsonParams,
  ManifestModuleDescriptor,
  ManifestProviderToken,
  MetadataClassEntry,
} from './interfaces';

import { isErr } from '@zipbul/result';
import { type AdapterStaticSpec, type ClassMetadata, ModuleGraph, type ModuleNode } from '../analyzer';
import { compareCodePoint, PathResolver } from '../../common';
import { ImportRegistry } from './import-registry';
import { InjectorGenerator } from './injector-generator';
import { MetadataGenerator } from './metadata-generator';

export class ManifestGenerator {
  private injectorGen = new InjectorGenerator();

  private metadataGen = new MetadataGenerator();

  generate(graph: ModuleGraph, classes: MetadataClassEntry[], outputDir: string): Result<string, Diagnostic> {
    const registry = new ImportRegistry(outputDir);
    const sortedClasses = [...classes].sort((a, b) => {
      const nameDiff = compareCodePoint(a.metadata.className, b.metadata.className);

      if (nameDiff !== 0) {
        return nameDiff;
      }

      return compareCodePoint(a.filePath, b.filePath);
    });

    sortedClasses.forEach(c => {
      registry.getAlias(c.metadata.className, c.filePath);
    });

    const injectorResult = this.injectorGen.generate(graph, registry);

    if (isErr(injectorResult)) {
      return injectorResult;
    }

    const injectorCode = injectorResult;
    const metadataCode = this.metadataGen.generate(classes, registry);
    const scopedKeysEntries: string[] = [];
    const sortedNodes = Array.from(graph.modules.values()).sort((a, b) => compareCodePoint(a.filePath, b.filePath));

    sortedNodes.forEach((node: ModuleNode) => {
      const providerTokens = Array.from(node.providers.keys()).sort(compareCodePoint);

      providerTokens.forEach((token: string) => {
        const providerDef = graph.classDefinitions.get(token);
        const alias = providerDef ? registry.getAlias(providerDef.metadata.className, providerDef.filePath) : token;

        scopedKeysEntries.push(`  map.set(${alias}, '${node.name}::${token}');`);
        scopedKeysEntries.push(`  map.set('${token}', '${node.name}::${token}');`);
      });

      const controllerNames = Array.from(node.controllers.values()).sort(compareCodePoint);

      controllerNames.forEach((ctrlName: string) => {
        let alias = ctrlName;
        const ctrlDef = graph.classDefinitions.get(ctrlName);

        if (ctrlDef) {
          alias = registry.getAlias(ctrlName, ctrlDef.filePath);
        }

        scopedKeysEntries.push(`  map.set(${alias}, '${node.name}::${ctrlName}');`);
        scopedKeysEntries.push(`  map.set('${ctrlName}', '${node.name}::${ctrlName}');`);
      });
    });

    const imports = registry.getImportStatements().join('\n');

    return `
${imports}

const deepFreeze = (obj: unknown, visited = new WeakSet<object>()): unknown => {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (visited.has(obj)) {
    return obj;
  }

  if (!Object.isFrozen(obj)) {
    visited.add(obj);
    Object.freeze(obj);
    Object.getOwnPropertyNames(obj).forEach(prop => {
      const record = obj as Record<string, unknown>;

      deepFreeze(record[prop], visited);
    });
  }

  return obj;
};

const sealMap = <K, V>(map: Map<K, V>): Map<K, V> => {
  (map as unknown as { set: (...args: unknown[]) => unknown }).set = () => {
    throw new Error("FATAL: AOT Registry is immutable.");
  };

  (map as unknown as { delete: (...args: unknown[]) => unknown }).delete = () => {
    throw new Error("FATAL: AOT Registry is immutable.");
  };

  (map as unknown as { clear: (...args: unknown[]) => unknown }).clear = () => {
    throw new Error("FATAL: AOT Registry is immutable.");
  };

  Object.freeze(map);
  return map;
};

const _meta = (
  className: string,
  decorators: readonly unknown[],
  params: readonly unknown[],
  methods: readonly unknown[],
  props: readonly unknown[],
): {
  className: string;
  decorators: readonly unknown[];
  constructorParams: readonly unknown[];
  methods: readonly unknown[];
  properties: readonly unknown[];
} => ({
  className,
  decorators,
  constructorParams: params,
  methods,
  properties: props
});

${injectorCode}

${metadataCode}

export function createScopedKeysMap() {
  const map = new Map();
${scopedKeysEntries.join('\n')}
  return sealMap(map);
}

export const metadataRegistry = createMetadataRegistry();
export const scopedKeysMap = createScopedKeysMap();

`;
  }

  generateJson(params: ManifestJsonParams): string {
    const manifestModel = this.buildJsonModel(params);

    return JSON.stringify(manifestModel, null, 2);
  }

  private buildJsonModel(params: ManifestJsonParams): ManifestJsonModel {
    const { graph, projectRoot, source, resolvedConfig, adapterStaticSpecs, handlerIndex } = params;
    const sortedModules = Array.from(graph.modules.values()).sort((a, b) => compareCodePoint(a.filePath, b.filePath));
    const moduleDescriptors = sortedModules.map(node => {
      const moduleRoot = dirname(node.filePath);
      const rootDir = PathResolver.normalize(relative(projectRoot, moduleRoot)) || '.';
      const file = PathResolver.normalize(relative(projectRoot, node.filePath));

      return {
        id: rootDir,
        name: node.name,
        rootDir,
        file,
      };
    });
    const sortedModuleDescriptors: ManifestModuleDescriptor[] = moduleDescriptors.sort((left, right) =>
      compareCodePoint(left.id, right.id),
    );
    const diNodes: ManifestDiNode[] = [];

    const isRecordValue = (value: AnalyzerValue | ClassMetadata): value is AnalyzerValueRecord => {
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    };

    const isAnalyzerValueArray = (value: AnalyzerValue | undefined): value is AnalyzerValue[] => {
      return Array.isArray(value);
    };

    const extractTokenName = (token: ManifestProviderToken): string | undefined => {
      if (typeof token === 'string') {
        return token;
      }

      if (typeof token === 'function') {
        return token.name.length > 0 ? token.name : undefined;
      }

      if (typeof token === 'symbol') {
        return token.description ?? token.toString();
      }

      if (!isRecordValue(token)) {
        return undefined;
      }

      const record = token;

      if (typeof record.__zipbul_ref === 'string') {
        return record.__zipbul_ref;
      }

      if (typeof record.__zipbul_forward_ref === 'string') {
        return record.__zipbul_forward_ref;
      }

      return undefined;
    };

    const isClassMetadata = (value: AnalyzerValue | ClassMetadata): value is ClassMetadata => {
      if (!isRecordValue(value)) {
        return false;
      }

      const constructorParams = value.constructorParams;

      return Array.isArray(constructorParams);
    };

    const extractDeps = (metadata: AnalyzerValue | ClassMetadata | undefined): string[] => {
      if (metadata === undefined) {
        return [];
      }

      if (isClassMetadata(metadata)) {
        return metadata.constructorParams
          .map(param => {
            const injectDec = param.decorators.find(d => d.name === 'Inject');
            const injectArgs = injectDec?.arguments;

            if (Array.isArray(injectArgs) && injectArgs.length > 0) {
              return extractTokenName(injectArgs[0]);
            }

            return extractTokenName(param.type);
          })
          .filter((value): value is string => typeof value === 'string');
      }

      const record = isRecordValue(metadata) ? metadata : null;

      if (record && isAnalyzerValueArray(record.inject)) {
        return record.inject.map(entry => extractTokenName(entry)).filter((value): value is string => typeof value === 'string');
      }

      return [];
    };

    const normalizeScope = (scope: string | undefined): string => {
      if (scope === 'request-context' || scope === 'request') {
        return 'request';
      }

      if (scope === 'transient') {
        return 'transient';
      }

      return 'singleton';
    };

    sortedModules.forEach(node => {
      const providerTokens = Array.from(node.providers.keys()).sort(compareCodePoint);

      providerTokens.forEach(token => {
        const provider = node.providers.get(token);

        if (!provider) {
          return;
        }

        const deps = extractDeps(provider.metadata).sort(compareCodePoint);

        diNodes.push({
          id: `${node.name}::${token}`,
          token,
          deps,
          scope: normalizeScope(provider.scope),
          provider: { token },
        });
      });
    });

    const sortedDiNodes = diNodes.sort((a, b) => compareCodePoint(a.id, b.id));
    const sortedAdapterStaticSpecs: Record<string, AdapterStaticSpec> = {};
    const sortedAdapterIds = Object.keys(adapterStaticSpecs).sort(compareCodePoint);

    sortedAdapterIds.forEach(adapterId => {
      const spec = adapterStaticSpecs[adapterId];

      if (spec) {
        sortedAdapterStaticSpecs[adapterId] = spec;
      }
    });

    const sortedHandlerIndex = [...handlerIndex].sort((a, b) => compareCodePoint(a.id, b.id));

    return {
      schemaVersion: '3',
      config: {
        sourcePath: PathResolver.normalize(source.path),
        sourceFormat: source.format,
        resolvedModuleConfig: {
          fileName: resolvedConfig.module.fileName,
        },
      },
      modules: sortedModuleDescriptors,
      adapterStaticSpecs: sortedAdapterStaticSpecs,
      diGraph: {
        nodes: sortedDiNodes,
      },
      handlerIndex: sortedHandlerIndex,
    };
  }
}
