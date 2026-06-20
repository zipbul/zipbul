import type { AnalyzerValue, AnalyzerValueRecord } from '../analyzer/types';
import type { ImportRegistry } from './import-registry';

import {
  ZIPBUL_REF, ZIPBUL_IMPORT_SOURCE, ZIPBUL_CALL, ZIPBUL_UNRESOLVABLE,
  ZIPBUL_COMPUTED_PREFIX, ZIPBUL_COMPUTED_KEY, ZIPBUL_COMPUTED_VALUE,
} from '@zipbul/common';
import { type ClassMetadata } from '../analyzer';
import { compareCodePoint } from '../../common';
import { isRecordValue, isAnalyzerValueArray, isNonEmptyString } from '../analyzer/type-guards';

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

  // Statically-unevaluable expressions (literals nested in call args, template
  // strings, complex expressions) are captured as their original source text;
  // re-emit it verbatim so the generated code reproduces the author's value
  // rather than the internal marker record.
  if (record[ZIPBUL_UNRESOLVABLE] === true) {
    return asString(record.sourceText) ?? 'undefined';
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

// Constructor-injection dependency resolution removed: DI is performed via
// inject() (gildash supports only modern decorators — no parameter decorators),
// so classes are instantiated with no-arg `new Class()` and resolve their
// dependencies through inject() in their own bodies.
