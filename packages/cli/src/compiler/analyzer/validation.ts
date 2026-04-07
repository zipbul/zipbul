import type { FileAnalysis } from './graph/interfaces';
import type { Diagnostic } from '../../diagnostics';
import type { Result } from '@zipbul/result';

import { err } from '@zipbul/result';
import { ZIPBUL_REF } from '@zipbul/common';
import { buildDiagnostic } from '../../diagnostics';
import { isRecordValue } from './type-guards';

export interface ApplicationEntry {
  filePath: string;
  entryRef: string;
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
        reason: 'createApplication call not found in recognized files.',
      }),
    );
  }

  if (callEntries.length > 1) {
    return err(
      buildDiagnostic({
        reason: 'Multiple createApplication calls detected in recognized files.',
      }),
    );
  }

  const entry = callEntries[0];

  if (entry === undefined) {
    return err(
      buildDiagnostic({
        reason: 'createApplication call not found in recognized files.',
      }),
    );
  }

  const args = entry.call.args ?? [];

  if (args.length !== 1) {
    return err(
      buildDiagnostic({
        reason: 'createApplication must take exactly one entry module argument.',
        file: entry.filePath,
      }),
    );
  }

  const entryArg = args[0];

  if (!isRecordValue(entryArg)) {
    return err(
      buildDiagnostic({
        reason: 'createApplication entry module must be a statically resolvable identifier.',
        file: entry.filePath,
      }),
    );
  }

  const entryRef = entryArg[ZIPBUL_REF];

  if (typeof entryRef !== 'string' || entryRef.length === 0) {
    return err(
      buildDiagnostic({
        reason: 'createApplication entry module must be a statically resolvable identifier.',
        file: entry.filePath,
      }),
    );
  }

  return { filePath: entry.filePath, entryRef };
}
