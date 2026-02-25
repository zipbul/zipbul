import type { BuildDiagnosticParams, Diagnostic } from './types';

export function buildDiagnostic(params: BuildDiagnosticParams): Diagnostic {
  const { code, severity, summary, reason } = params;
  const summaryText = `[${severity}/${code}] ${summary}`;
  const whyText = `[${severity}/${code}] ${reason}`;
  const howTitle = `[${severity}/${code}] Fix ${code}`;

  return {
    severity,
    code,
    summary: summaryText,
    why: whyText,
    where: [],
    how: [{ title: howTitle }],
  };
}
