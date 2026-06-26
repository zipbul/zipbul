import type { ErrorNormalizer } from '../../bun-sql';

/**
 * Normalizes Bun.SQL SQLite errors for MikroORM's official `SqliteExceptionConverter`, which
 * matches on `exception.message` substrings (not a code/errno).
 *
 * VERIFIED (live): Bun.SQL's SQLite error messages already carry the exact needles the converter
 * looks for — "UNIQUE constraint failed", "NOT NULL constraint failed", "CHECK constraint failed",
 * "FOREIGN KEY constraint failed", "no such table". So conversion to the typed MikroORM exceptions
 * works with an identity pass-through; no rewrite needed. Covered by `error-normalization.test.ts`
 * (sqlite lane — runs in the default no-docker lane). The class stays so the per-DB contract has a
 * home and any future Bun.SQL message change lands in one place.
 *
 * @internal
 */
export class BunSqliteErrorNormalizer implements ErrorNormalizer {
  normalize(error: unknown): unknown {
    return error;
  }
}
