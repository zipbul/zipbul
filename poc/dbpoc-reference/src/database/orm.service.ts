import { Injectable } from '@zipbul/common';
import { MikroOrmBase, BunPostgreSqlDriver } from '@zipbul-poc/bun-pg-driver';
import type { Options } from '@mikro-orm/core';
import { DbUser } from './user.entity';
@Injectable({ scope: 'singleton', visibleTo: 'all' })
export class OrmService extends MikroOrmBase {
  protected options(): Options<any> {
    return { driver: BunPostgreSqlDriver as any, clientUrl: 'postgres://poc:poc@127.0.0.1:55444/pocdb', entities: [DbUser] };
  }
  protected async seed(): Promise<void> {
    const em = this.orm.em.fork();
    em.persist(em.create(DbUser, { name: 'Ada Lovelace', email: 'ada@db.io' }));
    em.persist(em.create(DbUser, { name: 'Alan Turing', email: 'alan@db.io' }));
    await em.flush();
  }
}
