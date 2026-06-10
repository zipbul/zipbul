import { AbstractSqlDriver } from '@mikro-orm/sql';
import { SqlitePlatform } from '@mikro-orm/sqlite';
import type { Configuration } from '@mikro-orm/core';

import { BunSqliteConnection } from './sqlite.connection';

/**
 * MikroORM SQLite driver backed by Bun. Reuses the official {@link SqlitePlatform}.
 * See {@link BunSqliteConnection} for the no-reserve divergence that must be resolved.
 */
export class BunSqliteDriver extends AbstractSqlDriver<BunSqliteConnection, SqlitePlatform> {
  constructor(config: Configuration) {
    super(config, new SqlitePlatform(), BunSqliteConnection, ['kysely']);
  }
}
