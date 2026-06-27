import { AbstractSqlDriver } from '@mikro-orm/sql';
import { SqlitePlatform } from '@mikro-orm/sqlite';
import type { Configuration } from '@mikro-orm/core';

import { BunSqliteConnection } from './sqlite.connection';

/**
 * MikroORM SQLite driver backed by Bun. Reuses the official {@link SqlitePlatform}.
 * See {@link BunSqliteConnection} for how the single-connection (no-reserve) model is handled.
 */
export class BunSqliteDriver extends AbstractSqlDriver<BunSqliteConnection, SqlitePlatform> {
  constructor(config: Configuration) {
    super(config, new SqlitePlatform(), BunSqliteConnection, ['kysely']);
  }
}
