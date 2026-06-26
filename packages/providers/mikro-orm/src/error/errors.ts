import type { MikroOrmErrorReason } from './enums';
import type { MikroOrmErrorData } from './interfaces';

/**
 * The single error type the package throws for its OWN faults (configuration, hard Bun.SQL
 * ceilings, and wiring invariants), discriminated by {@link MikroOrmErrorReason}. This follows the
 * framework's one-class-plus-`reason` convention (`RateLimiterError`/`CorsError`), so a consumer
 * catches `MikroOrmError` and branches on `error.reason`.
 *
 * Per-request DB constraint violations are NOT this type — those are MikroORM's own typed
 * exceptions (`UniqueConstraintViolationException`, etc.), produced by its `ExceptionConverter` and
 * re-exported from the package root unchanged.
 */
export class MikroOrmError extends Error {
  readonly reason: MikroOrmErrorReason;

  constructor(data: MikroOrmErrorData, options?: { cause?: unknown }) {
    super(`@zipbul/mikro-orm: ${data.message}`, options);
    this.name = 'MikroOrmError';
    this.reason = data.reason;
  }
}
