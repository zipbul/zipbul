import { AbstractSqlDriver, AbstractSqlConnection } from '@mikro-orm/sql';
import { MySqlPlatform } from '@mikro-orm/mysql';
import type { Dialect } from 'kysely';
import { BunMysqlDialect } from './bun-sql-mysql-dialect';

class BunMyConn extends AbstractSqlConnection {
  createKyselyDialect(): Dialect {
    const url = (this.config.get('clientUrl') as string);
    return new BunMysqlDialect(url);
  }
}
export class BunMysqlDriver extends AbstractSqlDriver<BunMyConn, MySqlPlatform> {
  constructor(config: any) { super(config, new MySqlPlatform(), BunMyConn, ['kysely']); }
}
