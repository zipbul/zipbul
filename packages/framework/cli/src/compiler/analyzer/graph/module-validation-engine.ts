import type { Gildash } from '@zipbul/gildash';

import type { ClassDefinition, ProviderRef } from './interfaces';
import type { ModuleNode } from './module-node';

import {
  ZIPBUL_REF,
  SCOPE_SINGLETON, SCOPE_REQUEST,
} from '@zipbul/common';
import { Logger } from '@zipbul/logger';
import { toRecord, isAnalyzerValueArray, isClassMetadata } from '../type-guards';
import { extractTokenName, collectReferencedTokens } from './token-resolver';
import { assertVisibility, checkHeritageScopes } from './scope-visibility-resolver';
import { extractDeps } from './provider-resolver';

const logger = new Logger('compiler/module-validation');

/**
 * Validates visibility and scope rules across all modules.
 *
 * @param modules - All registered module nodes.
 * @param classMap - Class name → owning module node.
 * @param moduleInjectDeps - Module path → inject dependency tokens.
 * @param gildash - Optional gildash instance.
 * @param warnings - Mutable array for non-fatal warnings.
 * @public
 */
export function validateVisibilityAndScope(
  modules: ReadonlyMap<string, ModuleNode>,
  classMap: ReadonlyMap<string, ModuleNode>,
  moduleInjectDeps: ReadonlyMap<string, string[]>,
  providerInjectDeps: ReadonlyMap<string, string[]>,
  gildash: Gildash | undefined,
  warnings: string[],
): void {
  for (const node of modules.values()) {
    const injectDeps = moduleInjectDeps.get(node.filePath) ?? [];

    for (const depToken of injectDeps) {
      assertVisibility(node, depToken, 'inject', classMap);
    }

    for (const provider of node.providers.values()) {
      if (provider.metadata === undefined) {
        continue;
      }

      // A provider's dependencies are its inject() tokens (modern decorators have
      // no constructor injection) plus any useFactory deps; both must pass scope
      // validation so a singleton can't depend on a request-scoped provider.
      const deps = [
        ...extractDeps(provider, gildash, warnings),
        ...(provider.filePath !== undefined ? providerInjectDeps.get(provider.filePath) ?? [] : []),
      ];

      for (const depToken of deps) {
        assertVisibility(node, depToken, provider.token, classMap);

        const sourceScope = provider.scope ?? SCOPE_SINGLETON;
        const targetModule = classMap.get(depToken);

        if (!targetModule) {
          continue;
        }

        const targetProvider = targetModule.providers.get(depToken);

        if (!targetProvider) {
          continue;
        }

        const targetScope = targetProvider.scope ?? SCOPE_SINGLETON;

        if (sourceScope === SCOPE_SINGLETON && targetScope === SCOPE_REQUEST) {
          throw new Error(
            `Scope Violation: Singleton '${provider.token}' cannot inject Request-Scoped '${depToken}'.`,
          );
        }
      }
    }
  }
}

/**
 * Validates that registered providers implement their declared interfaces.
 *
 * @public
 */
export function validateProviderImplementations(
  modules: ReadonlyMap<string, ModuleNode>,
  classDefinitions: ReadonlyMap<string, ClassDefinition>,
  gildash: Gildash,
  warnings: string[],
): void {
  let interfaceNames: Set<string>;

  try {
    const interfaces = gildash.searchSymbols({ kind: 'interface', isExported: true });

    interfaceNames = new Set(interfaces.map(sym => sym.name));
  } catch {
    logger.warn('searchSymbols failed. Provider implementation validation disabled for this build.');
    interfaceNames = new Set();
  }

  for (const node of modules.values()) {
    for (const provider of node.providers.values()) {
      if (!interfaceNames.has(provider.token)) {
        continue;
      }

      const lookupPath = provider.filePath ?? classDefinitions.get(provider.token)?.filePath;

      if (!lookupPath) {
        continue;
      }

      try {
        const sym = gildash.getFullSymbol(provider.token, lookupPath);

        if (!sym || sym.kind !== 'interface') {
          continue;
        }

        const impls = gildash.getImplementations(provider.token, lookupPath);

        if (impls.length === 0) {
          continue;
        }

        const implNames = new Set(impls.map(impl => impl.symbolName));

        for (const candidate of node.providers.values()) {
          if (!isClassMetadata(candidate.metadata)) {
            continue;
          }

          const cls = candidate.metadata.className;

          if (!implNames.has(cls)) {
            warnings.push(
              `Provider '${cls}' in module '${node.name}' is registered for interface '${provider.token}' but does not implement it.`,
            );
          }
        }
      } catch {
        warnings.push(
          `Could not validate provider implementation for '${provider.token}' in module '${node.name}'. Symbol resolution failed.`,
        );
      }
    }
  }
}

/**
 * Validates that useClass/useExisting providers are type-compatible with their token.
 *
 * @public
 */
export function validateProviderTypeCompatibility(
  modules: ReadonlyMap<string, ModuleNode>,
  classDefinitions: ReadonlyMap<string, ClassDefinition>,
  gildash: Gildash,
  warnings: string[],
): void {
  for (const node of modules.values()) {
    for (const [token, ref] of node.providers) {
      const record = toRecord(ref.metadata ?? undefined);

      if (record === null) {
        continue;
      }

      let implToken: string | undefined;

      if (typeof record.useClass === 'string') {
        implToken = record.useClass;
      } else {
        const useClassRecord = toRecord(record.useClass);

        if (useClassRecord !== null && typeof useClassRecord[ZIPBUL_REF] === 'string') {
          implToken = useClassRecord[ZIPBUL_REF];
        }
      }

      if (typeof record.useExisting === 'string') {
        implToken = record.useExisting;
      } else if (implToken === undefined) {
        const useExistingRecord = toRecord(record.useExisting);

        if (useExistingRecord !== null && typeof useExistingRecord[ZIPBUL_REF] === 'string') {
          implToken = useExistingRecord[ZIPBUL_REF];
        }
      }

      if (implToken === undefined) {
        continue;
      }

      const tokenPath = ref.filePath ?? classDefinitions.get(token)?.filePath;
      const implPath = classDefinitions.get(implToken)?.filePath;

      if (!tokenPath || !implPath) {
        continue;
      }

      try {
        const compatible = gildash.isTypeAssignableTo(implToken, implPath, token, tokenPath);

        if (compatible === false) {
          warnings.push(
            `Provider '${implToken}' in module '${node.name}' is not assignable to '${token}'.`,
          );
        }
      } catch {
        /* semantic check unavailable — skip silently */
      }
    }
  }
}

/**
 * Validates that useFactory inject() tokens match factory parameter types.
 *
 * @public
 */
export function validateFactoryParamTypes(
  modules: ReadonlyMap<string, ModuleNode>,
  classDefinitions: ReadonlyMap<string, ClassDefinition>,
  gildash: Gildash,
  warnings: string[],
): void {
  for (const node of modules.values()) {
    for (const [token, ref] of node.providers) {
      const record = toRecord(ref.metadata ?? undefined);

      if (record === null || record.useFactory === undefined) {
        continue;
      }

      const factoryRecord = toRecord(record.useFactory);

      if (factoryRecord === null) {
        continue;
      }

      const factoryInjects = isAnalyzerValueArray(factoryRecord.__zipbul_factory_injects)
        ? factoryRecord.__zipbul_factory_injects
        : [];
      const factoryParams = isAnalyzerValueArray(factoryRecord.__zipbul_factory_params)
        ? factoryRecord.__zipbul_factory_params
        : [];

      if (factoryInjects.length === 0 || factoryParams.length === 0) {
        continue;
      }

      for (let paramIndex = 0; paramIndex < Math.min(factoryInjects.length, factoryParams.length); paramIndex++) {
        const injectRecord = toRecord(factoryInjects[paramIndex]);
        const paramRecord = toRecord(factoryParams[paramIndex]);

        if (injectRecord === null || paramRecord === null) {
          continue;
        }

        const injectTokenName = extractTokenName(injectRecord.token, gildash, warnings);
        const paramTypeName = typeof paramRecord.typeName === 'string' ? paramRecord.typeName : null;

        if (injectTokenName === 'UNKNOWN' || paramTypeName === null) {
          continue;
        }

        const injectDef = classDefinitions.get(injectTokenName);
        const paramImportSource = typeof paramRecord.importSource === 'string' ? paramRecord.importSource : undefined;
        const paramDef = paramImportSource !== undefined
          ? { filePath: paramImportSource }
          : classDefinitions.get(paramTypeName);

        if (!injectDef || !paramDef) {
          continue;
        }

        try {
          const compatible = gildash.isTypeAssignableTo(
            injectTokenName, injectDef.filePath,
            paramTypeName, paramDef.filePath,
          );

          if (compatible === false) {
            warnings.push(
              `useFactory of '${token}' in module '${node.name}': inject[${String(paramIndex)}] '${injectTokenName}' is not assignable to parameter type '${paramTypeName}'.`,
            );
          }
        } catch {
          /* semantic check unavailable — skip */
        }
      }
    }
  }
}

/**
 * Validates that no two modules share the same name.
 *
 * @public
 */
export function validateModuleNameUniqueness(modules: ReadonlyMap<string, ModuleNode>): void {
  const nameToPath = new Map<string, string>();

  for (const [filePath, node] of modules) {
    const existing = nameToPath.get(node.name);

    if (existing !== undefined) {
      throw new Error(
        `Duplicate module name '${node.name}' found in '${filePath}' and '${existing}'. Module names must be unique.`,
      );
    }

    nameToPath.set(node.name, filePath);
  }
}

/**
 * Validates inject() tokens inside useFactory provider definitions.
 *
 * @public
 */
export function validateFactoryInjectTokens(modules: ReadonlyMap<string, ModuleNode>): void {
  for (const node of modules.values()) {
    for (const [token, ref] of node.providers) {
      const record = toRecord(ref.metadata);

      if (record === null || record.useFactory === undefined) {
        continue;
      }

      const factoryRecord = toRecord(record.useFactory);

      if (factoryRecord === null) {
        continue;
      }

      const factoryInjects = isAnalyzerValueArray(factoryRecord.__zipbul_factory_injects)
        ? factoryRecord.__zipbul_factory_injects
        : [];

      for (const injectEntry of factoryInjects) {
        const injectRecord = toRecord(injectEntry);

        if (injectRecord === null) {
          continue;
        }

        if (injectRecord.tokenKind === 'invalid' || injectRecord.token === null) {
          throw new Error(
            `inject() token in useFactory of provider '${token}' in module '${node.name}' (${node.filePath}) is not statically determinable.`,
          );
        }
      }
    }
  }
}

/**
 * Validates inherited scope compatibility via gildash heritage chain.
 *
 * @public
 */
export async function validateInheritedScopes(
  modules: ReadonlyMap<string, ModuleNode>,
  classDefinitions: ReadonlyMap<string, ClassDefinition>,
  classMap: ReadonlyMap<string, ModuleNode>,
  gildash: Gildash,
  warnings: string[],
): Promise<void> {
  for (const node of modules.values()) {
    for (const provider of node.providers.values()) {
      const sourceScope = provider.scope ?? SCOPE_SINGLETON;
      if (sourceScope !== SCOPE_SINGLETON) continue;

      const classDef = classDefinitions.get(provider.token);
      if (!classDef) continue;

      try {
        const chain = await gildash.getHeritageChain(provider.token, classDef.filePath);
        checkHeritageScopes(chain, provider.token, sourceScope, classMap);
      } catch {
        warnings.push(
          `Could not validate inheritance scope for '${provider.token}' in '${classDef.filePath}'. Heritage chain resolution failed.`,
        );
      }
    }
  }
}

/**
 * Detects providers registered but never referenced by any consumer.
 *
 * @public
 */
export function validateUnusedProviders(
  modules: ReadonlyMap<string, ModuleNode>,
  moduleInjectDeps: ReadonlyMap<string, string[]>,
  gildash: Gildash | undefined,
  warnings: string[],
  extractDepsFromProvider: (provider: ProviderRef) => string[],
): void {
  for (const node of modules.values()) {
    const referencedTokens = collectReferencedTokens(node, moduleInjectDeps, gildash, warnings, extractDepsFromProvider);

    for (const token of node.providers.keys()) {
      if (node.controllers.has(token)) {
        continue;
      }

      if (!referencedTokens.has(token)) {
        warnings.push(
          `Provider '${token}' in module '${node.name}' is registered but never referenced.`,
        );
      }
    }
  }
}
