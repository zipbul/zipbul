import type { ErrorNormalizer } from '../../dialect';

/**
 * Normalizes Bun SQLite errors (e.g. `code='SQLITE_CONSTRAINT_UNIQUE'`, `errno=2067`)
 * for MikroORM's SQLite exception conversion.
 *
 * @internal
 */
export class SqliteErrorNormalizer implements ErrorNormalizer {
  normalize(error: unknown): unknown {
    // TODO(impl): map SQLITE_* codes / errno to the shape MikroORM's sqlite converter expects.
    return error;
  }
}
