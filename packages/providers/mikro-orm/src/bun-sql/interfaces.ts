import type { DialectAdapter, DatabaseIntrospector, QueryCompiler, Kysely } from 'kysely';

import type { BunSqlClient, SqlDialectKind } from './types';

/**
 * Per-DB Kysely building blocks injected into {@link BunSqlDialect}. Each driver
 * (postgres/mysql/sqlite) supplies the concrete trio for its database.
 */
export interface KyselyDialectParts {
  createQueryCompiler(): QueryCompiler;
  createAdapter(): DialectAdapter;
  createIntrospector(db: Kysely<unknown>): DatabaseIntrospector;
}

/**
 * Translates a raw Bun.SQL driver error into a shape MikroORM's official
 * ExceptionConverter understands. Implemented per-DB in `driver/<db>`.
 *
 * Contract (not an abstract class): concrete per-DB classes `implements` this so
 * error normalization is fully owned by each driver, with no cross-domain
 * abstract-class inheritance.
 */
export interface ErrorNormalizer {
  /** Mutate/replace the raw error so SQLSTATE-style matching works, then it is rethrown. */
  normalize(error: unknown): unknown;
}

/** Configuration for a {@link BunSqlDialect} instance. */
export interface BunSqlDialectOptions {
  readonly url: string;
  /** Database engine — selects the correct transaction-control SQL in the driver. */
  readonly dialect: SqlDialectKind;
  /** Connection pool size. Defaults to `DEFAULT_POOL_MAX`. */
  readonly poolMax?: number;
  /**
   * Whether the adapter pools connections and supports `reserve()` (postgres/mysql).
   * `false` for sqlite, which is a single synchronous connection with no reservation.
   * Defaults to `true`.
   */
  readonly pooled?: boolean;
  /**
   * Construct the Bun.SQL client with `safeIntegers` so integers past 2^53 keep full precision
   * (SQLite only — its INTEGER columns are otherwise coerced to lossy JS numbers). Bun.SQL then
   * returns every integer as a `bigint`; {@link BunSqlConnection} normalizes them back.
   */
  readonly safeIntegers?: boolean;
  /** Factory for the underlying Bun.SQL client (override for testing). */
  readonly createClient?: (url: string, poolMax: number) => BunSqlClient;
}
