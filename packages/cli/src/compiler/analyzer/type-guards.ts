import type { AnalyzerValue, AnalyzerValueRecord } from './types';

export function isRecordValue(value: unknown): value is AnalyzerValueRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isAnalyzerValueArray(value: unknown): value is AnalyzerValue[] {
  return Array.isArray(value);
}

export function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}
