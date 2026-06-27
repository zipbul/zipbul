import { Logger } from '@zipbul/logger';

import type { Diagnostic } from '../diagnostics';
import { DiagnosticError } from '../diagnostics';

/**
 * Emits a structured diagnostic via Logger at error level.
 *
 * Output shape (plain transport):
 *
 *   error: [<context>] <where.file>[/<symbol>] — <why>
 *   error: [<context>] how: <how>
 *
 * `<context>` is the caller-supplied tag (e.g. `'build'`, `'dev/rebuild'`,
 * `'adapter'`). `how:` is omitted when the diagnostic carries no
 * remediation. Plain (non-Diagnostic) errors fall through with the raw
 * message — no field extraction.
 *
 * @public
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

/**
 * Logs an arbitrary thrown value at error level. {@link DiagnosticError}
 * unwraps to the structured form via {@link reportDiagnostic}; everything
 * else is stringified through Logger's `%s` format specifier (which delegates
 * to `util.format` and handles `Error` / object / primitive uniformly).
 *
 * @public
 */
export function reportError(error: unknown, context: string): void {
  if (error instanceof DiagnosticError) {
    reportDiagnostic(error.diagnostic, context);
    return;
  }
  new Logger(context).error('%s', error);
}
