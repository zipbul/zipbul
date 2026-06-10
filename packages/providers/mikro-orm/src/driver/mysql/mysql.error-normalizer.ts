import type { ErrorNormalizer } from '../../bun-sql';

/**
 * Normalizes Bun.SQL MySQL errors for MikroORM's official `MySqlExceptionConverter`, which
 * switches on `exception.errno`.
 *
 * VERIFIED (live, MySQL 9.7 + MariaDB 11): Bun.SQL surfaces the native MySQL `errno` directly
 * (1062 unique, 1364 not-null, 3819 check, 1452 FK, 1146 missing-table) even though it puts a
 * generic `ERR_MYSQL_SERVER_ERROR` on `.code`. Since the converter reads `.errno`, no remap is
 * needed — this is a pass-through. The class is kept so the per-DB contract has a home and any
 * future Bun.SQL change lands in one place. Covered by `error-normalization.test.ts` (mysql lane).
 *
 * @internal
 */
export class BunMySqlErrorNormalizer implements ErrorNormalizer {
  normalize(error: unknown): unknown {
    return error;
  }
}
