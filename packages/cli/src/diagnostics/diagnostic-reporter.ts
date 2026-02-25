import type { Diagnostic, ReportDiagnosticsParams } from './types';

import { compareCodePoint } from '../common';

const sortDiagnostics = (diagnostics: Diagnostic[]): Diagnostic[] => {
  return diagnostics.slice().sort((left, right) => {
    if (left.severity !== right.severity) {
      return left.severity === 'error' ? -1 : 1;
    }

    const codeDiff = compareCodePoint(left.code, right.code);

    if (codeDiff !== 0) {
      return codeDiff;
    }

    return compareCodePoint(left.summary, right.summary);
  });
};

export function reportDiagnostic(diagnostic: Diagnostic): void {
  const payload = JSON.stringify(diagnostic, null, 2);

  console.error(payload);
}

export function reportDiagnostics(params: ReportDiagnosticsParams): void {
  const sorted = sortDiagnostics(params.diagnostics);
  const payload = JSON.stringify(sorted, null, 2);

  console.error(payload);
}
