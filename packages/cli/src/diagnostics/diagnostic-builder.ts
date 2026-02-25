import type { BuildDiagnosticParams, Diagnostic } from './types';

export function buildDiagnostic(params: BuildDiagnosticParams): Diagnostic {
  const { severity, reason } = params;

  return {
    severity,
    why: reason,
    ...(params.file !== undefined && {
      where: {
        file: params.file,
        ...(params.symbol !== undefined && { symbol: params.symbol }),
      },
    }),
    ...(params.how !== undefined && { how: params.how }),
  };
}
