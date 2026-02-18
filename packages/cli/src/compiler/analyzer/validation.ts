import type { FileAnalysis } from './graph/interfaces';
import type { AnalyzerValue, AnalyzerValueRecord } from './types';

import { buildDiagnostic, DiagnosticReportError } from '../../diagnostics';

export function isAnalyzerRecord(value: AnalyzerValue): value is AnalyzerValueRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// MUST: MUST-1
// MUST: MUST-2
export function validateCreateApplication(fileMap: Map<string, FileAnalysis>): void {
  const callEntries = Array.from(fileMap.values())
    .flatMap(file => (file.createApplicationCalls ?? []).map(call => ({ call, filePath: file.filePath })))
    .filter(entry => entry.call !== undefined);

  if (callEntries.length === 0) {
    throw new DiagnosticReportError(
      buildDiagnostic({
        code: 'ZIPBUL_APP_002',
        severity: 'fatal',
        summary: 'createApplication entry module not found.',
        reason: 'createApplication call not found in recognized files.',
        file: '.',
      }),
    );
  }

  if (callEntries.length > 1) {
    throw new DiagnosticReportError(
      buildDiagnostic({
        code: 'ZIPBUL_APP_018',
        severity: 'fatal',
        summary: 'Multiple createApplication calls detected.',
        reason: 'Multiple createApplication calls detected in recognized files.',
        file: callEntries[0]?.filePath ?? '.',
      }),
    );
  }

  const entry = callEntries[0];

  if (entry === undefined) {
    return;
  }

  const args = entry.call.args ?? [];

  if (args.length !== 1) {
    throw new DiagnosticReportError(
      buildDiagnostic({
        code: 'ZIPBUL_APP_002',
        severity: 'fatal',
        summary: 'Invalid createApplication entry argument.',
        reason: 'createApplication must take exactly one entry module argument.',
        file: entry.filePath,
      }),
    );
  }

  const entryArg = args[0];

  if (!isAnalyzerRecord(entryArg)) {
    throw new DiagnosticReportError(
      buildDiagnostic({
        code: 'ZIPBUL_APP_002',
        severity: 'fatal',
        summary: 'Invalid createApplication entry argument.',
        reason: 'createApplication entry module must be a statically resolvable identifier.',
        file: entry.filePath,
      }),
    );
  }

  const entryRef = entryArg.__zipbul_ref;

  if (typeof entryRef !== 'string' || entryRef.length === 0) {
    throw new DiagnosticReportError(
      buildDiagnostic({
        code: 'ZIPBUL_APP_002',
        severity: 'fatal',
        summary: 'Invalid createApplication entry argument.',
        reason: 'createApplication entry module must be a statically resolvable identifier.',
        file: entry.filePath,
      }),
    );
  }
}
