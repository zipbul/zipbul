import { AbstractSqlConnection } from '@mikro-orm/sql';
import type { Dialect } from 'kysely';

import { BunSqlDialect } from '../../dialect';
import { POSTGRES_KYSELY_PARTS } from './kysely-parts';
import { PostgresErrorNormalizer } from './postgres.error-normalizer';

/**
 * MikroORM SQL connection for PostgreSQL backed by Bun.SQL. Its only job is to
 * assemble the Bun.SQL-backed Kysely dialect; AbstractSqlConnection handles
 * execute/begin/commit/rollback/transactional on top of it.
 */
export class PostgresConnection extends AbstractSqlConnection {
  createKyselyDialect(): Dialect {
    const url = this.config.get('clientUrl') as string;
    return new BunSqlDialect(POSTGRES_KYSELY_PARTS, new PostgresErrorNormalizer(), { url, dialect: 'postgres' });
  }
}
