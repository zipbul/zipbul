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
    .flatMap(file => (file.createApplicationCalls ?? []).map(call => ({ call, filePath: file.filePath })));

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

  const entry = callEntries[0]!;
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

  if (!isRecordValue(entryArg) || typeof entryArg[ZIPBUL_REF] !== 'string' || (entryArg[ZIPBUL_REF] as string).length === 0) {
    return err(
      buildDiagnostic({
        reason: 'createApplication entry module must be a statically resolvable identifier.',
        file: entry.filePath,
        how: 'Pass an imported module class directly (e.g. `createApplication(AppModule)`). Computed expressions, dynamic imports, and re-exports are not supported.',
      }),
    );
  }

  const entryRef = entryArg[ZIPBUL_REF] as string;

  return { filePath: entry.filePath, entryRef };
}
