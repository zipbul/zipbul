import { AbstractSqlConnection } from '@mikro-orm/sql';
import type { Dialect } from 'kysely';

import { BunSqlDialect, resolveBunSqlUrl, type ConnectionComponents } from '../../dialect';
import { POSTGRES_KYSELY_PARTS } from './kysely-parts';
import { PostgresErrorNormalizer } from './postgres.error-normalizer';

/**
 * MikroORM SQL connection for PostgreSQL backed by Bun.SQL. Its only job is to
 * assemble the Bun.SQL-backed Kysely dialect; AbstractSqlConnection handles
 * execute/begin/commit/rollback/transactional on top of it.
 *
 * The URL accepts a full `clientUrl` (query params like `?sslmode=require` preserved) OR
 * discrete `host`/`port`/`user`/`password`/`dbName` config; `pool.max` sets the pool size.
 */
export class PostgresConnection extends AbstractSqlConnection {
  override createKyselyDialect(): Dialect {
    const clientUrl = this.config.get('clientUrl') as string | undefined;
    const url = resolveBunSqlUrl('postgres', clientUrl, this.getConnectionOptions() as ConnectionComponents);
    const poolMax = (this.config.get('pool') as { max?: number } | undefined)?.max;
    return new BunSqlDialect(POSTGRES_KYSELY_PARTS, new PostgresErrorNormalizer(), {
      url,
      dialect: 'postgres',
      ...(poolMax != null ? { poolMax } : {}),
    });
  }
}
