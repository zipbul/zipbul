import { AbstractSqlDriver } from '@mikro-orm/sql';
import { SqlitePlatform } from '@mikro-orm/sqlite';
import type { Configuration } from '@mikro-orm/core';

import { SqliteConnection } from './sqlite.connection';

/**
 * MikroORM SQLite driver backed by Bun. Reuses the official {@link SqlitePlatform}.
 * See {@link SqliteConnection} for the no-reserve divergence that must be resolved.
 */
export class BunSqliteDriver extends AbstractSqlDriver<SqliteConnection, SqlitePlatform> {
  constructor(config: Configuration) {
    super(config, new SqlitePlatform(), SqliteConnection, ['kysely']);
  }
}
