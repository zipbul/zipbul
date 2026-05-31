import { AbstractSqlConnection } from '@mikro-orm/sql';
import type { Dialect } from 'kysely';

import { BunSqlDialect } from '../../dialect';
import { MYSQL_KYSELY_PARTS } from './kysely-parts';
import { MySqlErrorNormalizer } from './mysql.error-normalizer';

/** MikroORM SQL connection for MySQL backed by Bun.SQL. */
export class MySqlConnection extends AbstractSqlConnection {
  createKyselyDialect(): Dialect {
    const url = this.config.get('clientUrl') as string;
    return new BunSqlDialect(MYSQL_KYSELY_PARTS, new MySqlErrorNormalizer(), { url, dialect: 'mysql' });
  }
}
