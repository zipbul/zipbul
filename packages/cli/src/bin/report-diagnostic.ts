import type { Diagnostic } from '../diagnostics';
import { DiagnosticError } from '../diagnostics';

/**
 * Emits a structured diagnostic to stderr in the agent-line format:
 *
 *   error: <where.file>[:<where.symbol>] — <why>
 *     how: <how>
 *
 * `how` is omitted when the diagnostic doesn't carry a remediation. Plain
 * (non-Diagnostic) errors fall through with just `error: <message>`.
 */
export function reportDiagnostic(diagnostic: Diagnostic): void {
  const where = diagnostic.where;
  const location = where !== undefined
    ? (where.symbol !== undefined ? `${where.file}:${where.symbol}` : where.file)
    : null;

  if (location !== null) {
    console.error('error: %s — %s', location, diagnostic.why);
  } else {
    console.error('error: %s', diagnostic.why);
  }

  if (diagnostic.how !== undefined) {
    console.error('  how: %s', diagnostic.how);
  }
}

/**
 * Reports any thrown value. DiagnosticError unwraps to the structured form;
 * other Error / non-Error values surface as `error: <message>`.
 */
export function reportDiagnosticError(error: unknown): void {
  if (error instanceof DiagnosticError) {
    reportDiagnostic(error.diagnostic);
    return;
  }
  console.error('error: %s', error instanceof Error ? error.message : String(error));
}
