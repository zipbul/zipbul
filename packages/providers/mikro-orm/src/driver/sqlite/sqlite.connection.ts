import { AbstractSqlConnection } from '@mikro-orm/sql';
import type { Dialect } from 'kysely';

import { BunSqlDialect } from '../../dialect';
import { SQLITE_KYSELY_PARTS } from './kysely-parts';
import { SqliteErrorNormalizer } from './sqlite.error-normalizer';

/**
 * MikroORM SQL connection for SQLite backed by Bun.SQL.
 *
 * SQLite is a single synchronous connection with no `reserve()`, so the dialect is built
 * with `pooled: false` — the driver runs queries on the client directly. The Bun.SQL URL is
 * derived from MikroORM's `dbName` (e.g. `:memory:` or a file path).
 */
export class SqliteConnection extends AbstractSqlConnection {
  createKyselyDialect(): Dialect {
    const dbName = (this.config.get('dbName') as string | undefined) ?? ':memory:';
    const url = dbName.includes('://') ? dbName : `sqlite://${dbName}`;
    return new BunSqlDialect(SQLITE_KYSELY_PARTS, new SqliteErrorNormalizer(), { url, pooled: false, dialect: 'sqlite' });
  }
}
