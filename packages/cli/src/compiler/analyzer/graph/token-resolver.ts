import type { Gildash } from '@zipbul/gildash';

import type { AnalyzerValue, AnalyzerValueRecord } from '../types';
import type { FileAnalysis, ProviderTokenValue } from './interfaces';

import { basename, dirname } from 'path';

import { ZIPBUL_REF, ZIPBUL_IMPORT_SOURCE } from '@zipbul/common';
import { compareCodePoint } from '../../../common';
import { toRecord, isAnalyzerValueArray } from '../type-guards';

/**
 * Extracts a human-readable token name from a provider token value.
 *
 * @param value - The raw token value (string, function, symbol, or analyzer record).
 * @param gildash - Optional gildash instance for symbol resolution.
 * @param warnings - Mutable array to collect non-fatal warnings.
 * @returns The resolved token name, or `'UNKNOWN'` when not determinable.
 * @public
 */
export function extractTokenName(
  value: ProviderTokenValue | AnalyzerValue,
  gildash: Gildash | undefined,
  warnings: string[],
): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'function') {
    return value.name;
  }

  if (typeof value === 'symbol') {
    return value.description ?? value.toString();
  }

  const record = toRecord(value);

  if (record && typeof record[ZIPBUL_REF] === 'string') {
    if (gildash && typeof record[ZIPBUL_IMPORT_SOURCE] === 'string') {
      try {
        const resolved = gildash.resolveSymbol(record[ZIPBUL_REF], record[ZIPBUL_IMPORT_SOURCE]);
        if (!resolved.circular) return resolved.originalName;
      } catch {
        warnings.push(
          `[Zipbul AOT] Symbol resolution failed for '${record[ZIPBUL_REF]}'. Using raw reference name.`,
        );
      }
    }
    return record[ZIPBUL_REF];
  }

  return 'UNKNOWN';
}

/**
 * Normalizes a cycle path so the lexicographically smallest rotation is canonical.
 *
 * @param path - Cycle member names (may repeat the start node at the end).
 * @returns The canonicalized rotation.
 * @public
 */
export function normalizeCycle(path: readonly string[]): string[] {
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

    if (compareStringArray(rotated, best) < 0) {
      best = rotated;
    }
  }

  return best;
}

/**
 * Lexicographic comparison for string arrays.
 *
 * @returns Negative if `a < b`, positive if `a > b`, zero if equal.
 * @public
 */
export function compareStringArray(a: readonly string[], b: readonly string[]): number {
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

/**
 * Collects module names from module entries, falling back to directory basename.
 *
 * @param moduleEntries - Module path → owned file set pairs.
 * @param fileMap - All parsed file analyses.
 * @returns Map of module file path → module name.
 * @public
 */
export function collectModuleNames(
  moduleEntries: ReadonlyArray<readonly [string, Set<string>]>,
  fileMap: ReadonlyMap<string, FileAnalysis>,
): Map<string, string> {
  const names = new Map<string, string>();

  for (const [modulePath] of moduleEntries) {
    const moduleFile = fileMap.get(modulePath);
    const rawDef = moduleFile?.moduleDefinition;
    const moduleRootDir = dirname(modulePath);
    const moduleName = rawDef?.name ?? basename(moduleRootDir);

    names.set(modulePath, moduleName);
  }

  return names;
}

/**
 * Collects exported defineModule marker names per module file.
 *
 * @param moduleEntries - Module path → owned file set pairs.
 * @param fileMap - All parsed file analyses.
 * @returns Map of module file path → set of exported marker names.
 * @public
 */
export function collectModuleMarkerExports(
  moduleEntries: ReadonlyArray<readonly [string, Set<string>]>,
  fileMap: ReadonlyMap<string, FileAnalysis>,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();

  for (const [modulePath] of moduleEntries) {
    const moduleFile = fileMap.get(modulePath);
    const exports = new Set<string>();
    const defineCalls = moduleFile?.defineModuleCalls ?? [];

    for (const call of defineCalls) {
      if (typeof call.exportedName === 'string' && call.exportedName.length > 0) {
        exports.add(call.exportedName);
      }
    }

    if (exports.size > 0) {
      map.set(modulePath, exports);
    }
  }

  return map;
}

/**
 * Resolves an import source string to a module file path.
 *
 * @param importSource - The raw import source.
 * @param moduleFileSet - Set of known module file paths.
 * @returns The matched module path, or `null`.
 * @public
 */
export function resolveModulePath(
  importSource: string | undefined,
  moduleFileSet: ReadonlySet<string>,
): string | null {
  if (typeof importSource !== 'string' || importSource.length === 0) {
    return null;
  }

  const candidates = [
    importSource,
    `${importSource}.ts`,
    `${importSource}/index.ts`,
  ];

  for (const candidate of candidates) {
    if (moduleFileSet.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Resolves an analyzer value token to a module name via marker exports.
 *
 * @param token - The analyzer value representing a module marker reference.
 * @param modulePath - Current module file path (fallback target).
 * @param moduleName - Current module name (fallback).
 * @param moduleFileSet - Set of known module file paths.
 * @param moduleNameByPath - Module file path → module name.
 * @param moduleMarkerExports - Module file path → set of marker export names.
 * @returns The resolved module name, or `null`.
 * @public
 */
export function resolveModuleMarker(
  token: AnalyzerValue,
  modulePath: string,
  moduleName: string,
  moduleFileSet: ReadonlySet<string>,
  moduleNameByPath: ReadonlyMap<string, string>,
  moduleMarkerExports: ReadonlyMap<string, Set<string>>,
): string | null {
  const record = toRecord(token);

  if (!record || typeof record[ZIPBUL_REF] !== 'string') {
    return null;
  }

  const refName = record[ZIPBUL_REF];
  const importSource = typeof record[ZIPBUL_IMPORT_SOURCE] === 'string' ? record[ZIPBUL_IMPORT_SOURCE] : undefined;
  const targetModulePath = resolveModulePath(importSource, moduleFileSet) ?? modulePath;
  const exports = moduleMarkerExports.get(targetModulePath);

  if (!exports || exports.size === 0) {
    return null;
  }

  if (exports.has('default')) {
    return moduleNameByPath.get(targetModulePath) ?? moduleName;
  }

  if (exports.has(refName)) {
    return moduleNameByPath.get(targetModulePath) ?? moduleName;
  }

  return null;
}

/**
 * Collects inject() dependency tokens from a file analysis.
 *
 * @param fileAnalysis - The parsed file analysis.
 * @param gildash - Optional gildash instance for symbol resolution.
 * @param warnings - Mutable array to collect non-fatal warnings.
 * @returns Array of dependency token names.
 * @public
 */
export function collectInjectDeps(
  fileAnalysis: FileAnalysis,
  gildash: Gildash | undefined,
  warnings: string[],
): string[] {
  const injectCalls = fileAnalysis.injectCalls ?? [];

  if (injectCalls.length === 0) {
    return [];
  }

  const deps: string[] = [];

  for (const call of injectCalls) {
    if (call.tokenKind === 'invalid') {
      throw new Error('[Zipbul AOT] inject() token is not statically determinable.');
    }

    if (call.token === null) {
      throw new Error('[Zipbul AOT] inject() token is not statically determinable.');
    }

    const tokenName = extractTokenName(call.token, gildash, warnings);

    if (!tokenName || tokenName === 'UNKNOWN') {
      throw new Error('[Zipbul AOT] inject() token is not statically determinable.');
    }

    deps.push(tokenName);
  }

  return deps;
}

/**
 * Collects all tokens referenced by a module node's providers, inject deps, and controllers.
 *
 * @param node - The module node.
 * @param classDefinitions - All class definitions in the graph.
 * @param moduleInjectDeps - Module path → inject dependency tokens.
 * @param gildash - Optional gildash instance.
 * @param warnings - Mutable array for warnings.
 * @param extractDepsFromProvider - Delegate for extracting deps from a provider ref.
 * @returns Set of referenced token names.
 * @public
 */
export function collectReferencedTokens(
  node: import('./module-node').ModuleNode,
  classDefinitions: ReadonlyMap<string, import('./interfaces').ClassDefinition>,
  moduleInjectDeps: ReadonlyMap<string, string[]>,
  gildash: Gildash | undefined,
  warnings: string[],
  extractDepsFromProvider: (provider: import('./interfaces').ProviderRef) => string[],
): Set<string> {
  const referenced = new Set<string>();

  for (const provider of node.providers.values()) {
    const deps = extractDepsFromProvider(provider);

    for (const dep of deps) {
      referenced.add(dep);
    }

    const record = toRecord(provider.metadata);

    if (record !== null) {
      if (typeof record.useExisting === 'string') {
        referenced.add(record.useExisting);
      }

      const useExistingRecord = toRecord(record.useExisting);

      if (useExistingRecord !== null && typeof useExistingRecord[ZIPBUL_REF] === 'string') {
        referenced.add(useExistingRecord[ZIPBUL_REF]);
      }

      collectFactoryInjectTokens(record, referenced, gildash, warnings);
    }
  }

  const injectDeps = moduleInjectDeps.get(node.filePath);

  if (injectDeps !== undefined) {
    for (const dep of injectDeps) {
      referenced.add(dep);
    }
  }

  for (const ctrlName of node.controllers) {
    const classDef = classDefinitions.get(ctrlName);

    if (classDef === undefined) {
      continue;
    }

    for (const param of classDef.metadata.constructorParams) {
      const tokenName = extractTokenName(param.type, gildash, warnings);

      if (tokenName !== 'UNKNOWN') {
        referenced.add(tokenName);
      }
    }
  }

  return referenced;
}

/**
 * Collects inject tokens from a useFactory provider's factory inject entries.
 *
 * @param record - The provider metadata record.
 * @param referenced - Mutable set to add tokens into.
 * @param gildash - Optional gildash instance.
 * @param warnings - Mutable array for warnings.
 * @public
 */
export function collectFactoryInjectTokens(
  record: AnalyzerValueRecord,
  referenced: Set<string>,
  gildash: Gildash | undefined,
  warnings: string[],
): void {
  const factoryRecord = toRecord(record.useFactory);

  if (factoryRecord === null) {
    return;
  }

  const factoryInjects = isAnalyzerValueArray(factoryRecord.__zipbul_factory_injects)
    ? factoryRecord.__zipbul_factory_injects
    : [];

  for (const entry of factoryInjects) {
    const entryRecord = toRecord(entry);

    if (entryRecord === null) {
      continue;
    }

    const tokenName = extractTokenName(entryRecord.token, gildash, warnings);

    if (tokenName !== 'UNKNOWN') {
      referenced.add(tokenName);
    }
  }

  if (isAnalyzerValueArray(record.inject)) {
    for (const token of record.inject) {
      const tokenName = extractTokenName(token, gildash, warnings);

      if (tokenName !== 'UNKNOWN') {
        referenced.add(tokenName);
      }
    }
  }
}
