import { AbstractSqlDriver } from '@mikro-orm/sql';
import { PostgreSqlPlatform } from '@mikro-orm/postgresql';
import type { Configuration } from '@mikro-orm/core';

import { PostgresConnection } from './postgres.connection';

/**
 * MikroORM PostgreSQL driver backed by Bun's native Bun.SQL (zero `pg` dependency).
 * Reuses the official {@link PostgreSqlPlatform} for SQL generation, schema helper,
 * exception converter, and quoting.
 */
export class BunPostgreSqlDriver extends AbstractSqlDriver<PostgresConnection, PostgreSqlPlatform> {
  constructor(config: Configuration) {
    super(config, new PostgreSqlPlatform(), PostgresConnection, ['kysely']);
  }
}
