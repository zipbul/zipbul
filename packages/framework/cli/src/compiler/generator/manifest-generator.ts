import { dirname, relative } from 'path';

import type { Result } from '@zipbul/result';
import type { AnalyzerValue } from '../analyzer/types';
import type { Diagnostic } from '../../diagnostics/types';
import type { HandlerIndexEntry, RouteRegistration } from '../analyzer/interfaces';
import type {
  ManifestDiNode,
  ManifestJsonModel,
  ManifestJsonParams,
  ManifestModuleDescriptor,
  ManifestProviderToken,
  MetadataClassEntry,
} from './interfaces';

import { isErr } from '@zipbul/result';
import {
  ZIPBUL_REF, ZIPBUL_LAZY_REF,
  SCOPED_KEY_SEPARATOR,
  SCOPE_SINGLETON, SCOPE_REQUEST, SCOPE_TRANSIENT,
} from '@zipbul/common';
import { type AdapterStaticSchema, type ClassMetadata, ModuleGraph, type ModuleNode } from '../analyzer';
import { compareCodePoint, PathResolver } from '../../common';
import { isRecordValue, isAnalyzerValueArray, isClassMetadata } from '../analyzer/type-guards';
import { ImportRegistry } from './import-registry';
import { InjectorGenerator } from './injector-generator';
import { MetadataGenerator } from './metadata-generator';
import { selectRegistryClasses } from './registry-class-selector';

export class ManifestGenerator {
  private injectorGen = new InjectorGenerator();

  private metadataGen = new MetadataGenerator();

  generate(graph: ModuleGraph, classes: MetadataClassEntry[], outputDir: string, handlerIndex: readonly HandlerIndexEntry[] = [], routeRegistrations: readonly RouteRegistration[] = [], projectSrcDir?: string): Result<string, Diagnostic> {
    const registry = new ImportRegistry(outputDir, projectSrcDir);
    // The metadata registry is a className→constructor lookup for the router only
    // (controllers + handler DTOs). Everything else — providers, baker @Recipe DTOs
    // not referenced by a handler, scanned services — is never resolved through it.
    const registryClasses = selectRegistryClasses(classes, graph, handlerIndex);
    const sortedClasses = [...registryClasses].sort((a, b) => {
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
    const metadataCode = this.metadataGen.generate(registryClasses, registry);
    const scopedKeysEntries: string[] = [];
    const sortedNodes = Array.from(graph.modules.values()).sort((a, b) => compareCodePoint(a.filePath, b.filePath));

    sortedNodes.forEach((node: ModuleNode) => {
      const providerTokens = Array.from(node.providers.keys()).sort(compareCodePoint);

      providerTokens.forEach((token: string) => {
        const providerRef = node.providers.get(token);
        const providerFilePath = providerRef?.filePath;
        const fallbackDef = graph.classDefinitions.get(token);
        const filePath = providerFilePath ?? fallbackDef?.filePath;
        const alias = filePath ? registry.getAlias(token, filePath) : token;

        scopedKeysEntries.push(`  map.set(${alias}, '${node.name}${SCOPED_KEY_SEPARATOR}${token}');`);
      });

      const controllerNames = Array.from(node.controllers.values()).sort(compareCodePoint);

      controllerNames.forEach((ctrlName: string) => {
        const ctrlDef = graph.classDefinitions.get(ctrlName);
        const alias = ctrlDef ? registry.getAlias(ctrlName, ctrlDef.filePath) : ctrlName;

        scopedKeysEntries.push(`  map.set(${alias}, '${node.name}${SCOPED_KEY_SEPARATOR}${ctrlName}');`);
      });
    });

    const controllerEntries: string[] = [];

    sortedNodes.forEach((node: ModuleNode) => {
      const controllerNames = Array.from(node.controllers.values()).sort(compareCodePoint);

      controllerNames.forEach((ctrlName: string) => {
        const ctrlDef = graph.classDefinitions.get(ctrlName);

        if (!ctrlDef) {
          return;
        }

        const alias = registry.getAlias(ctrlName, ctrlDef.filePath);
        const scopedKey = `${node.name}${SCOPED_KEY_SEPARATOR}${ctrlName}`;
        controllerEntries.push(`  factories.set('${scopedKey}', () => runInInjectionContext(__container__, () => new ${alias}()));`);
      });
    });

    // Route registrations must be generated BEFORE import collection,
    // because they add imports for decorator argument references
    // (e.g. @UseExceptionFilters(paymentExceptionFilter)).
    const routeRegistrationCode = this.generateRouteRegistrations(routeRegistrations, registry, graph);

    const imports = registry.getImportStatements().join('\n');

    return `// @ts-nocheck
// AOT-generated runtime artifact. Do not edit by hand and do not type-check.
${imports}
import { registerBootstrapState } from "@zipbul/core";

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
): {
  className: string;
  decorators: readonly unknown[];
} => ({
  className,
  decorators
});

${injectorCode}

${metadataCode}

export function createScopedKeysMap() {
  const map = new Map();
${scopedKeysEntries.join('\n')}
  return sealMap(map);
}

// ── Immutable, build-time artifacts (safe to share across test runs) ──
// metadataRegistry / scopedKeysMap / handlerIndex are pure data extracted by
// the AOT compiler. They don't carry per-instance state, so they are built
// once at module load and reused.
export const metadataRegistry = createMetadataRegistry();
export const scopedKeysMap = createScopedKeysMap();
export const handlerIndex = ${JSON.stringify(handlerIndex)} as const;

// ── Per-install state (fresh on every installRuntime() call) ──
// The container, the route-level middleware/filter/guard bindings, and the
// controller factory map are all installation-scoped: they carry references
// to provider singletons that the test toolkit may override between runs.
// Each installRuntime() invocation rebuilds them from scratch and pushes a
// new BootstrapState — multi-test isolation is therefore automatic.

export function installRuntime() {
  const __container__ = createContainer();

  // Route-level pipeline registrations (middleware/filter/guard container keys)
${routeRegistrationCode.split('\n').map(l => l.length > 0 ? '  ' + l : l).join('\n')}

  const factories = new Map();
${controllerEntries.map(l => '  ' + l).join('\n')}

  registerBootstrapState({
    container: __container__,
    metadataRegistry,
    scopedKeys: scopedKeysMap,
    isAotRuntime: true,
    adapterConfig,
    handlerIndex,
    controllerFactories: factories,
  });
}

// Production / CLI entry: install once on module load so existing entry.ts
// callers (and 'bun dist/entry.js') see a fully-wired bootstrap state.
installRuntime();

`;
  }

  private generateRouteRegistrations(registrations: readonly RouteRegistration[], registry: ImportRegistry, graph: ModuleGraph): string {
    if (registrations.length === 0) {
      return '';
    }

    const allKeys = graph.getAllRegisteredKeys();
    const lines: string[] = [];

    for (const reg of registrations) {
      const refName = this.extractRefName(reg.value);

      // C-1: Validate middleware/filter/guard class is registered as a provider
      if (refName !== undefined && graph.classDefinitions.has(refName)) {
        const refModule = graph.classMap.get(refName);
        const refScopedKey = refModule
          ? `${refModule.name}${SCOPED_KEY_SEPARATOR}${refName}`
          : refName;

        if (!allKeys.has(refScopedKey)) {
          throw new Error(`Class '${refName}' used in pipeline decorator is not registered as a provider. Add it to the module's providers array or decorate it with @Injectable().`);
        }
      }

      const serialized = this.injectorGen.serializeValuePublic(reg.value, registry);

      lines.push(`__container__.set('${reg.key}', () => ${serialized});`);
    }

    return lines.join('\n');
  }

  private extractRefName(value: AnalyzerValue): string | undefined {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return undefined;
    }

    if (!isRecordValue(value)) {
      return undefined;
    }

    if (typeof value[ZIPBUL_REF] === 'string') {
      return value[ZIPBUL_REF];
    }

    if (typeof value[ZIPBUL_LAZY_REF] === 'string') {
      return value[ZIPBUL_LAZY_REF];
    }

    return undefined;
  }

  generateJson(params: ManifestJsonParams): string {
    const manifestModel = this.buildJsonModel(params);

    return JSON.stringify(manifestModel, null, 2);
  }

  private buildJsonModel(params: ManifestJsonParams): ManifestJsonModel {
    const { graph, projectRoot, source, resolvedConfig, adapterStaticSchemas, handlerIndex } = params;
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

      if (typeof record[ZIPBUL_REF] === 'string') {
        return record[ZIPBUL_REF];
      }

      if (typeof record[ZIPBUL_LAZY_REF] === 'string') {
        return record[ZIPBUL_LAZY_REF];
      }

      return undefined;
    };

    const extractDeps = (metadata: AnalyzerValue | ClassMetadata | undefined): string[] => {
      if (metadata === undefined) {
        return [];
      }

      // Class providers resolve dependencies via inject() in their own bodies,
      // not constructor params — so they list no constructor-derived deps here.
      if (isClassMetadata(metadata)) {
        return [];
      }

      const record = isRecordValue(metadata) ? metadata : null;

      if (record && isAnalyzerValueArray(record.inject)) {
        return record.inject.map(entry => extractTokenName(entry)).filter((value): value is string => typeof value === 'string');
      }

      return [];
    };

    const normalizeScope = (scope: string | undefined): string => {
      if (scope === SCOPE_REQUEST) {
        return SCOPE_REQUEST;
      }

      if (scope === SCOPE_TRANSIENT) {
        return SCOPE_TRANSIENT;
      }

      return SCOPE_SINGLETON;
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
          id: `${node.name}${SCOPED_KEY_SEPARATOR}${token}`,
          token,
          deps,
          scope: normalizeScope(provider.scope),
          provider: { token },
        });
      });
    });

    const sortedDiNodes = diNodes.sort((a, b) => compareCodePoint(a.id, b.id));
    const sortedAdapterStaticSchemas: Record<string, AdapterStaticSchema> = {};
    const sortedAdapterIds = Object.keys(adapterStaticSchemas).sort(compareCodePoint);

    sortedAdapterIds.forEach(adapterId => {
      const schema = adapterStaticSchemas[adapterId];

      if (schema) {
        sortedAdapterStaticSchemas[adapterId] = schema;
      }
    });

    const sortedHandlerIndex = [...handlerIndex].sort((a, b) => compareCodePoint(a.id, b.id));

    return {
      config: {
        sourcePath: PathResolver.normalize(source.path),
        sourceFormat: source.format,
        resolvedModuleConfig: {
          fileName: resolvedConfig.module.fileName,
        },
      },
      modules: sortedModuleDescriptors,
      adapterStaticSchemas: sortedAdapterStaticSchemas,
      diGraph: {
        nodes: sortedDiNodes,
      },
      handlerIndex: sortedHandlerIndex,
    };
  }
}
