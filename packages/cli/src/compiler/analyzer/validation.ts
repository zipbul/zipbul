import type { FileAnalysis } from './graph/interfaces';
import type { AnalyzerValue, AnalyzerValueRecord } from './types';
import type { Diagnostic } from '../../diagnostics';
import type { Result } from '@zipbul/result';

import { err } from '@zipbul/result';
import { buildDiagnostic } from '../../diagnostics';

export interface ApplicationEntry {
  filePath: string;
  entryRef: string;
}

export function isAnalyzerRecord(value: AnalyzerValue): value is AnalyzerValueRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// MUST: MUST-1
// MUST: MUST-2
export function validateCreateApplication(fileMap: Map<string, FileAnalysis>): Result<ApplicationEntry, Diagnostic> {
  const callEntries = Array.from(fileMap.values())
    .flatMap(file => (file.createApplicationCalls ?? []).map(call => ({ call, filePath: file.filePath })))
    .filter(entry => entry.call !== undefined);

  if (callEntries.length === 0) {
    return err(
      buildDiagnostic({
        severity: 'error',
        reason: 'createApplication call not found in recognized files.',
      }),
    );
  }

  if (callEntries.length > 1) {
    return err(
      buildDiagnostic({
        severity: 'error',
        reason: 'Multiple createApplication calls detected in recognized files.',
      }),
    );
  }

  const entry = callEntries[0];

  if (entry === undefined) {
    return err(
      buildDiagnostic({
        severity: 'error',
        reason: 'createApplication call not found in recognized files.',
      }),
    );
  }

  const args = entry.call.args ?? [];

  if (args.length !== 1) {
    return err(
      buildDiagnostic({
        severity: 'error',
        reason: 'createApplication must take exactly one entry module argument.',
        file: entry.filePath,
      }),
    );
  }

  const entryArg = args[0];

  if (!isAnalyzerRecord(entryArg)) {
    return err(
      buildDiagnostic({
        severity: 'error',
        reason: 'createApplication entry module must be a statically resolvable identifier.',
        file: entry.filePath,
      }),
    );
  }

  const entryRef = entryArg.__zipbul_ref;

  if (typeof entryRef !== 'string' || entryRef.length === 0) {
    return err(
      buildDiagnostic({
        severity: 'error',
        reason: 'createApplication entry module must be a statically resolvable identifier.',
        file: entry.filePath,
      }),
    );
  }

  return { filePath: entry.filePath, entryRef };
}
