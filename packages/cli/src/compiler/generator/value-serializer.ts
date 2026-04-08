import type { AnalyzerValue, AnalyzerValueRecord } from '../analyzer/types';
import type { ImportRegistry } from './import-registry';

import {
  ZIPBUL_REF, ZIPBUL_LAZY_REF, ZIPBUL_IMPORT_SOURCE, ZIPBUL_CALL,
  ZIPBUL_COMPUTED_PREFIX, ZIPBUL_COMPUTED_KEY, ZIPBUL_COMPUTED_VALUE,
  SCOPED_KEY_SEPARATOR,
} from '@zipbul/common';
import { type ClassMetadata, ModuleGraph, type ModuleNode } from '../analyzer';
import { compareCodePoint } from '../../common';
import { isRecordValue, isAnalyzerValueArray, isNonEmptyString, isUnresolvable } from '../analyzer/type-guards';

type RecordValue = AnalyzerValueRecord;

type GeneratorValue = AnalyzerValue | symbol | ((...args: readonly AnalyzerValue[]) => AnalyzerValue);

/**
 * Generates a deterministic string key for a value, used for deduplication and stable sorting.
 * Handles primitives, arrays, and records with circular reference detection.
 *
 * @param value - The value to generate a key for.
 * @param visited - WeakSet tracking visited records for circular reference detection.
 * @returns A stable string key representing the value.
 */
export const stableKey = (value: GeneratorValue, visited = new WeakSet<AnalyzerValueRecord>()): string => {
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

/**
 * Extracts a string value from an AnalyzerValue, returning undefined if the value is not a string.
 *
 * @param value - The analyzer value to extract a string from.
 * @returns The string value, or undefined if not a string.
 */
export const asString = (value: AnalyzerValue): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  return value;
};

/**
 * Narrows a value to a record type, returning null if the value is not a valid record.
 *
 * @param value - The value to narrow.
 * @returns The value as a RecordValue, or null.
 */
export const asRecord = (value: GeneratorValue | ClassMetadata): RecordValue | null => {
  if (!isRecordValue(value)) {
    return null;
  }

  return value;
};

/**
 * Extracts a reference name from an AnalyzerValue.
 * Handles both plain string values and record values containing a ZIPBUL_REF key.
 *
 * @param value - The analyzer value to extract a ref name from.
 * @returns The reference name string, or null if not found.
 */
export const getRefName = (value: AnalyzerValue): string | null => {
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

/**
 * Extracts a lazy reference name from an AnalyzerValue record.
 *
 * @param value - The analyzer value to extract a lazy ref name from.
 * @returns The lazy reference name string, or null if not found.
 */
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

/**
 * Serializes an analyzer value to a generated code string.
 * Recursively handles primitives, arrays, records, references, and call expressions.
 *
 * @param value - The analyzer value to serialize.
 * @param registry - The import registry for resolving and tracking import aliases.
 * @returns Generated code string representing the value.
 */
export const serializeValue = (value: AnalyzerValue, registry: ImportRegistry): string => {
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
    return `[${value.map(v => serializeValue(v, registry)).join(', ')}]`;
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

    const args = (isAnalyzerValueArray(record.args) ? record.args : []).map(a => serializeValue(a, registry)).join(', ');

    return `${callName}(${args})`;
  }

  const entries = Object.entries(record).sort(([a], [b]) => compareCodePoint(a, b));
  const props = entries.map(([key, entryValue]) => {
    if (key.startsWith(ZIPBUL_COMPUTED_PREFIX)) {
      const computed = asRecord(entryValue) ?? {};
      const keyContent = serializeValue(computed[ZIPBUL_COMPUTED_KEY], registry);
      const valContent = serializeValue(computed[ZIPBUL_COMPUTED_VALUE], registry);

      return `[${keyContent}]: ${valContent}`;
    }

    return `'${key}': ${serializeValue(entryValue, registry)}`;
  });

  return `{ ${props.join(', ')} }`;
};

/**
 * Resolves constructor dependency injection tokens for a class and generates
 * container.get() call expressions for each parameter.
 *
 * @param meta - Class metadata containing constructor parameter information.
 * @param node - The module node the class belongs to.
 * @param graph - The module dependency graph for token resolution.
 * @param allKeys - Set of all registered scoped keys across all modules.
 * @returns Array of generated code strings for each constructor parameter.
 */
export const resolveConstructorDeps = (meta: ClassMetadata, node: ModuleNode, graph: ModuleGraph, allKeys: Set<string>): string[] => {
  return meta.constructorParams.map(param => {
    let token: AnalyzerValue = param.type;

    if (isUnresolvable(token)) {
      throw new Error(`[Zipbul AOT] Constructor parameter '${param.name}' of '${meta.className}': dependency type must be a statically resolvable class reference. Found: ${token.nodeType ?? token.sourceText ?? 'unknown'} expression.`);
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
};
