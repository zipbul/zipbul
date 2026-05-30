import { AbstractSqlDriver } from '@mikro-orm/sql';
import { MySqlPlatform } from '@mikro-orm/mysql';
import type { Configuration } from '@mikro-orm/core';

import { MySqlConnection } from './mysql.connection';

/**
 * MikroORM MySQL driver backed by Bun's native Bun.SQL (zero `mysql2` dependency).
 * Reuses the official {@link MySqlPlatform}.
 */
export class BunMySqlDriver extends AbstractSqlDriver<MySqlConnection, MySqlPlatform> {
  constructor(config: Configuration) {
    super(config, new MySqlPlatform(), MySqlConnection, ['kysely']);
  }
}
