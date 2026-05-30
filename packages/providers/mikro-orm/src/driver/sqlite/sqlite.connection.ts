import { AbstractSqlConnection } from '@mikro-orm/sql';
import type { Dialect } from 'kysely';

import { BunSqlDialect } from '../../dialect';
import { SQLITE_KYSELY_PARTS } from './kysely-parts';
import { SqliteErrorNormalizer } from './sqlite.error-normalizer';

/**
 * MikroORM SQL connection for SQLite backed by Bun.
 *
 * DIVERGENCE (TODO impl): Bun.SQL's SQLite adapter does NOT support `sql.reserve()`,
 * which the shared {@link BunSqlDialect} uses for pooled transactions. SQLite is
 * single-connection, so this connection must wire a no-reserve acquisition path
 * (use the client directly, or bridge `bun:sqlite`'s synchronous handle). The
 * current wiring reuses BunSqlDialect as a structural placeholder and must be
 * adjusted before SQLite is functional.
 */
export class SqliteConnection extends AbstractSqlConnection {
  createKyselyDialect(): Dialect {
    const url = this.config.get('clientUrl') as string;
    return new BunSqlDialect(SQLITE_KYSELY_PARTS, new SqliteErrorNormalizer(), { url, poolMax: 1 });
  }
}
