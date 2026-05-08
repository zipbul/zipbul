import { buildDiagnostic, DiagnosticError } from '../../diagnostics';

/**
 * Adapter-build diagnostic category. Prefixed onto the diagnostic's `reason`
 * so downstream tooling can filter without depending on a separate field in
 * the shared `Diagnostic` shape.
 */
export type DiagnosticCategory = 'SYNTAX' | 'CONTRACT' | 'MISSING_EXPORT' | 'DUPLICATE' | 'TYPE' | 'IO';

export interface DiagParams {
  reason: string;
  file?: string;
  symbol?: string;
  how?: string;
  /** Pre-resolved line/column from gildash `ExtractedSymbol.span`. */
  position?: { line: number; column: number };
}

export function diag(category: DiagnosticCategory, params: DiagParams): DiagnosticError {
  let position = '';
  if (params.position !== undefined) {
    position = ` at ${params.file ?? '<source>'}:${params.position.line}:${params.position.column}`;
  }
  const taggedReason = `[${category}] ${params.reason}${position}`;

  return new DiagnosticError(buildDiagnostic({
    reason: taggedReason,
    ...(params.file !== undefined ? { file: params.file } : {}),
    ...(params.symbol !== undefined ? { symbol: params.symbol } : {}),
    ...(params.how !== undefined ? { how: params.how } : {}),
  }));
}
