import { buildDiagnostic, DiagnosticError } from '../../diagnostics';

export interface DiagParams {
  reason: string;
  file?: string;
  symbol?: string;
  how?: string;
  /** Pre-resolved line/column from gildash `ExtractedSymbol.span`. */
  position?: { line: number; column: number };
}

/**
 * Adapter-build diagnostic factory. Wraps `buildDiagnostic` with optional
 * source-position annotation: when `position` is supplied, ` at <file>:<line>:<col>`
 * is appended to the reason so the full "where" anchors at the precise call
 * site (the standard `where` field carries the file but not the offset).
 *
 * No category labels (`[CONTRACT]`, `[SYNTAX]`, ...) — the message body is
 * detailed natural language. Caller's Logger context (`[adapter]`) already
 * scopes the diagnostic; what mattered for category filtering was actually
 * never consumed.
 */
export function diag(params: DiagParams): DiagnosticError {
  const positionSuffix = params.position !== undefined
    ? ` at ${params.file ?? '<source>'}:${params.position.line}:${params.position.column}`
    : '';

  return new DiagnosticError(buildDiagnostic({
    reason: `${params.reason}${positionSuffix}`,
    ...(params.file !== undefined ? { file: params.file } : {}),
    ...(params.symbol !== undefined ? { symbol: params.symbol } : {}),
    ...(params.how !== undefined ? { how: params.how } : {}),
  }));
}
