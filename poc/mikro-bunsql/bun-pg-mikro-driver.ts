import { AbstractSqlDriver, AbstractSqlConnection, BasePostgreSqlPlatform } from '@mikro-orm/sql';
import type { Dialect } from 'kysely';
import { BunSqlPgDialect } from './bun-sql-pg-dialect';

class BunPgConnection extends AbstractSqlConnection {
  createKyselyDialect(_overrides: Record<string, unknown>): Dialect {
    const url = (this.config.get('clientUrl') as string)
      ?? `postgres://${this.config.get('user')}:${this.config.get('password')}@${this.config.get('host')}:${this.config.get('port')}/${this.config.get('dbName')}`;
    return new BunSqlPgDialect(url);
  }
}

export class BunPgDriver extends AbstractSqlDriver<BunPgConnection, BasePostgreSqlPlatform> {
  constructor(config: any) {
    super(config, new BasePostgreSqlPlatform(), BunPgConnection, ['kysely']);
  }
}
