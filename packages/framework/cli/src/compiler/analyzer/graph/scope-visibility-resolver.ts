import type { HeritageNode } from '@zipbul/gildash';

import type { AnalyzerValue } from '../types';
import type { InjectableOptions, VisibilityResolution } from './interfaces';
import type { ModuleNode } from './module-node';

import {
  VISIBILITY_ALL, VISIBILITY_MODULE,
  SCOPE_SINGLETON, SCOPE_REQUEST, SCOPE_TRANSIENT,
} from '@zipbul/common';
import { compareCodePoint } from '../../../common';
import { toRecord, isAnalyzerValueArray } from '../type-guards';
import { resolveModuleMarker } from './token-resolver';

/**
 * Asserts that a consumer module has visibility to a dependency token.
 *
 * @param node - The consuming module node.
 * @param depToken - The dependency token being injected.
 * @param sourceLabel - Label for the consumer (used in error messages).
 * @param classMap - Map of class name → owning module node.
 * @throws When the dependency is not visible from the consumer module.
 * @public
 */
export function assertVisibility(
  node: ModuleNode,
  depToken: string,
  sourceLabel: string,
  classMap: ReadonlyMap<string, ModuleNode>,
): void {
  const targetModule = classMap.get(depToken);

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
      `Visibility Violation: '${sourceLabel}' in module '${node.name}' tries to inject '${depToken}' from '${targetModule.name}', but it is module-only.`,
    );
  }

  const allowlist = targetProvider.visibleTo ?? [];

  if (!allowlist.includes(node.name)) {
    throw new Error(
      `Visibility Violation: '${sourceLabel}' in module '${node.name}' tries to inject '${depToken}' from '${targetModule.name}', but it is not allowlisted.`,
    );
  }
}

/**
 * Resolves the visibility setting from a `visibleTo` decorator argument.
 *
 * @param visibleTo - Raw `visibleTo` value from the decorator.
 * @param modulePath - Current module file path.
 * @param moduleName - Current module name.
 * @param moduleFileSet - Set of known module file paths.
 * @param moduleNameByPath - Module file path → module name.
 * @param moduleMarkerExports - Module file path → marker export names.
 * @returns The resolved visibility.
 * @public
 */
export function resolveVisibility(
  visibleTo: AnalyzerValue | undefined,
  modulePath: string,
  moduleName: string,
  moduleFileSet: ReadonlySet<string>,
  moduleNameByPath: ReadonlyMap<string, string>,
  moduleMarkerExports: ReadonlyMap<string, Set<string>>,
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

    throw new Error(`Invalid Injectable visibleTo value: '${visibleTo}'.`);
  }

  const arrayValue = isAnalyzerValueArray(visibleTo) ? visibleTo : null;

  if (arrayValue === null) {
    throw new Error('Injectable visibleTo must be "all", "module", or ModuleMarkerList.');
  }

  if (arrayValue.length === 0) {
    throw new Error('Injectable visibleTo allowlist must not be empty.');
  }

  const resolved = arrayValue
    .map(token => resolveModuleMarker(token, modulePath, moduleName, moduleFileSet, moduleNameByPath, moduleMarkerExports))
    .filter((value): value is string => typeof value === 'string');

  if (resolved.length !== arrayValue.length) {
    throw new Error('Injectable visibleTo contains non-determinable module markers.');
  }

  const unique = Array.from(new Set(resolved)).sort(compareCodePoint);

  return { kind: 'allowlist', visibleTo: unique };
}

/**
 * Resolves the scope setting from decorator arguments.
 *
 * @param scope - Raw `scope` value.
 * @param legacyLifetime - Legacy `lifetime` value (fallback).
 * @returns The resolved scope string.
 * @public
 */
export function resolveScope(
  scope: AnalyzerValue | undefined,
  legacyLifetime: AnalyzerValue | undefined,
): InjectableOptions['scope'] {
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

  throw new Error(`Invalid provider scope '${raw}'.`);
}

/**
 * Parses @Injectable decorator options (visibility, scope) at graph build time.
 *
 * @param value - The raw decorator argument value.
 * @param modulePath - Current module file path.
 * @param moduleName - Current module name.
 * @param moduleFileSet - Set of known module file paths.
 * @param moduleNameByPath - Module file path → module name.
 * @param moduleMarkerExports - Module file path → marker export names.
 * @returns Parsed injectable options.
 * @public
 */
export function parseInjectableOptions(
  value: AnalyzerValue | undefined,
  modulePath: string,
  moduleName: string,
  moduleFileSet: ReadonlySet<string>,
  moduleNameByPath: ReadonlyMap<string, string>,
  moduleMarkerExports: ReadonlyMap<string, Set<string>>,
): InjectableOptions {
  const record = value === undefined ? null : toRecord(value);
  const visibility = resolveVisibility(record?.visibleTo, modulePath, moduleName, moduleFileSet, moduleNameByPath, moduleMarkerExports);
  const scope = resolveScope(record?.scope, record?.lifetime);

  const opts: InjectableOptions = {
    visibility: visibility.kind,
    scope,
  };
  if (visibility.visibleTo !== undefined) {
    opts.visibleTo = visibility.visibleTo;
  }
  return opts;
}

/**
 * Recursively checks heritage chain for scope violations.
 *
 * @param node - Heritage tree node to check.
 * @param providerToken - The root provider token (for error messages).
 * @param sourceScope - The scope of the root provider.
 * @param classMap - Map of class name → owning module node.
 * @param modules - All registered modules.
 * @throws When a singleton inherits from a request-scoped dependency.
 * @public
 */
export function checkHeritageScopes(
  node: HeritageNode,
  providerToken: string,
  sourceScope: string,
  classMap: ReadonlyMap<string, ModuleNode>,
): void {
  for (const child of node.children) {
    if (child.kind !== 'extends') continue;

    const parentModule = classMap.get(child.symbolName);
    if (!parentModule) continue;

    const parentProvider = parentModule.providers.get(child.symbolName);
    if (!parentProvider) continue;

    const parentScope = parentProvider.scope ?? SCOPE_SINGLETON;
    if (sourceScope === SCOPE_SINGLETON && parentScope === SCOPE_REQUEST) {
      throw new Error(
        `Scope Violation: Singleton '${providerToken}' inherits Request-Scoped dependency through '${child.symbolName}'.`,
      );
    }

    checkHeritageScopes(child, providerToken, sourceScope, classMap);
  }
}
