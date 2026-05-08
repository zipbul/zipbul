import { Logger } from '@zipbul/logger';

import type { Diagnostic } from '../diagnostics';
import { DiagnosticError } from '../diagnostics';

/**
 * Emits a structured diagnostic via Logger at error level. The Logger plain
 * transport renders this as:
 *
 *   error: [<context>] <where.file>[/<symbol>] — <why>
 *   error: [<context>] how: <how>
 *
 * `how` is omitted when the diagnostic doesn't carry a remediation. Plain
 * (non-Diagnostic) errors fall through with the raw message.
 */
export function reportDiagnostic(diagnostic: Diagnostic, context: string): void {
  const log = new Logger(context);
  const where = diagnostic.where;
  const location = where !== undefined
    ? (where.symbol !== undefined ? `${where.file}/${where.symbol}` : where.file)
    : null;

  if (location !== null) {
    log.error('%s — %s', location, diagnostic.why);
  } else {
    log.error('%s', diagnostic.why);
  }

  if (diagnostic.how !== undefined) {
    log.error('how: %s', diagnostic.how);
  }
}

export function reportDiagnosticError(error: unknown, context: string): void {
  if (error instanceof DiagnosticError) {
    reportDiagnostic(error.diagnostic, context);
    return;
  }
  new Logger(context).error('%s', error instanceof Error ? error.message : String(error));
}
