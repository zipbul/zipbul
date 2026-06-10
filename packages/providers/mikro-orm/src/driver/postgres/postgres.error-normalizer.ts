import type { ErrorNormalizer } from '../../bun-sql';

/**
 * Normalizes Bun.SQL PostgreSQL errors so MikroORM's official
 * `PostgreSqlExceptionConverter` (which switches on `error.code === '23505'` etc.)
 * matches them. Bun.SQL puts the SQLSTATE in `.errno` and sets `.code` to a generic
 * `ERR_POSTGRES_*` string, so we copy `errno -> code`, preserving detail/constraint/table.
 *
 * @internal
 */
export class PostgresErrorNormalizer implements ErrorNormalizer {
  normalize(error: unknown): unknown {
    const e = error as { errno?: unknown; code?: unknown } | null;
    if (e && typeof e.errno !== 'undefined' && (typeof e.code !== 'string' || e.code.startsWith('ERR_'))) {
      try {
        (e as { code: unknown }).code = String(e.errno);
      } catch {
        // error object frozen — leave as-is
      }
    }
    return error;
  }
}
