import { AbstractSqlConnection } from '@mikro-orm/sql';
import type { Dialect } from 'kysely';

import { BunSqlDialect, resolveBunSqlUrl, type ConnectionComponents } from '../../dialect';
import { MYSQL_KYSELY_PARTS } from './kysely-parts';
import { MySqlErrorNormalizer } from './mysql.error-normalizer';

/**
 * MikroORM SQL connection for MySQL/MariaDB backed by Bun.SQL. Accepts a full `clientUrl`
 * or discrete `host`/`port`/`user`/`password`/`dbName` config; `pool.max` sets the pool size.
 */
export class MySqlConnection extends AbstractSqlConnection {
  override createKyselyDialect(): Dialect {
    const clientUrl = this.config.get('clientUrl') as string | undefined;
    const url = resolveBunSqlUrl('mysql', clientUrl, this.getConnectionOptions() as ConnectionComponents);
    const poolMax = (this.config.get('pool') as { max?: number } | undefined)?.max;
    return new BunSqlDialect(MYSQL_KYSELY_PARTS, new MySqlErrorNormalizer(), {
      url,
      dialect: 'mysql',
      ...(poolMax != null ? { poolMax } : {}),
    });
  }
}
