import { BaseSqliteConnection } from '@mikro-orm/sql';
import type { Routine, Transaction } from '@mikro-orm/core';
import type { Dialect } from 'kysely';

import { BunSqlDialect, type BunSqlDialectOptions } from '../../dialect';
import { SQLITE_KYSELY_PARTS } from './kysely-parts';
import { SqliteErrorNormalizer } from './sqlite.error-normalizer';

/**
 * MikroORM SQL connection for SQLite backed by Bun.SQL.
 *
 * SQLite is a single synchronous connection with no `reserve()`, so the dialect is built
 * with `pooled: false` — the driver runs queries on the client directly. The Bun.SQL URL is
 * derived from MikroORM's `dbName` (e.g. `:memory:` or a file path). `driverOptions` (the
 * `overrides`) are merged on top, but `pooled` and `dialect` stay fixed.
 *
 * Extends {@link BaseSqliteConnection} (not AbstractSqlConnection) so its `connect()` enables
 * `pragma foreign_keys = on` (SQLite defaults it OFF) and honours `attachDatabases`.
 */
export class SqliteConnection extends BaseSqliteConnection {
  override createKyselyDialect(overrides?: Partial<BunSqlDialectOptions>): Dialect {
    const dbName = (this.config.get('dbName') as string | undefined) ?? ':memory:';
    const url = dbName.includes('://') ? dbName : `sqlite://${dbName}`;
    return new BunSqlDialect(SQLITE_KYSELY_PARTS, new SqliteErrorNormalizer(), {
      url,
      ...overrides,
      pooled: false,
      safeIntegers: true,
      dialect: 'sqlite',
    });
  }

  /**
   * SQLite has no stored procedures, and the official driver bridges functions by registering
   * the routine's `bodyJs` as a UDF through better-sqlite3's `database.function()`. Bun.SQL
   * exposes no UDF-registration API (verified: the sqlite client has no `.function`), so neither
   * path is reachable here. We throw accurate, actionable errors rather than the generic core
   * "not supported" message — this is a hard Bun.SQL ceiling, documented in FEATURE-MATRIX.md.
   */
  override async callRoutine<T>(routine: Routine, _args?: Record<string, unknown>, _ctx?: Transaction): Promise<T> {
    if (routine.type === 'procedure') {
      throw new Error(
        `Stored procedures are not supported on SQLite. Routine ${routine.name} cannot be invoked here — define a separate code path for SQLite or call it only against a server-side database.`,
      );
    }
    throw new Error(
      `Function ${routine.name} cannot be invoked on the Bun.SQL SQLite backend: Bun.SQL exposes no user-defined-function registration API (unlike better-sqlite3's database.function()), so the official 'bodyJs' UDF bridge is unavailable. Call this routine against postgres/mysql, or use bun:sqlite directly for SQLite-only UDFs.`,
    );
  }
}
