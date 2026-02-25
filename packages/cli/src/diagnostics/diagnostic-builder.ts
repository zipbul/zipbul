import type { BuildDiagnosticParams, Diagnostic } from './types';

export function buildDiagnostic(params: BuildDiagnosticParams): Diagnostic {
  const { code, severity, summary, reason } = params;
  const summaryText = `[${severity}/${code}] ${summary}`;
  const whyText = `[${severity}/${code}] ${reason}`;

  return {
    severity,
    code,
    summary: summaryText,
    why: whyText,
    ...(params.file !== undefined && { where: { file: params.file } }),
    ...(params.how !== undefined && { how: params.how }),
  };
}
