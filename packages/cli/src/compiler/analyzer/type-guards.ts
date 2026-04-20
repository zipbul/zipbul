import { ZIPBUL_UNRESOLVABLE } from '@zipbul/common';

import type { ClassMetadata } from './interfaces';
import type { AnalyzerValue, AnalyzerValueRecord } from './types';

/**
 * Record returned by `parseExpression` when the AST node type is not
 * statically resolvable (e.g. ternary, tagged template, `await`).
 * Carries source location so consumption sites can produce actionable diagnostics.
 */
export interface UnresolvableExpression extends AnalyzerValueRecord {
  readonly [ZIPBUL_UNRESOLVABLE]: true;
  readonly nodeType?: string | undefined;
  readonly sourceText?: string | undefined;
  readonly start?: number | undefined;
  readonly end?: number | undefined;
}

export function isRecordValue(value: unknown): value is AnalyzerValueRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isAnalyzerValueArray(value: unknown): value is AnalyzerValue[] {
  return Array.isArray(value);
}

export function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Checks whether an analyzer value is an unresolvable expression marker
 * produced by `parseExpression` for unsupported AST node types.
 *
 * @param value - The analyzer value to check.
 * @returns `true` when the value is an {@link UnresolvableExpression} marker.
 */
export function isUnresolvable(value: unknown): value is UnresolvableExpression {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && ZIPBUL_UNRESOLVABLE in value;
}

/**
 * Narrows an analyzer value to a record or returns `null`.
 *
 * @param value - The value to narrow.
 * @returns The value as a record, or `null` if it is not an object.
 * @public
 */
export function toRecord(value: unknown): AnalyzerValueRecord | null {
  if (!isRecordValue(value)) {
    return null;
  }

  return value;
}

/**
 * Checks whether an analyzer value is a fully parsed class metadata object
 * as produced by the AST parser.
 *
 * @param value - The value to check.
 * @returns `true` when the value has the shape of {@link ClassMetadata}.
 * @public
 */
export function isClassMetadata(value: unknown): value is ClassMetadata {
  if (!isRecordValue(value)) {
    return false;
  }

  const record = value;

  return (
    typeof record.className === 'string' &&
    Array.isArray(record.decorators) &&
    Array.isArray(record.constructorParams) &&
    Array.isArray(record.methods) &&
    Array.isArray(record.properties) &&
    typeof record.imports === 'object'
  );
}
