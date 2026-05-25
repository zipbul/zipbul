import { Injectable } from '@zipbul/common';
import { Logger } from '@zipbul/logger';
import { MikroORM, SqlSchemaGenerator } from '@mikro-orm/sql';
import type { EntityManager, EntityRepository } from '@mikro-orm/sql';
import { BunPostgreSqlDriver } from '@zipbul-poc/bun-pg-driver';
import { DbUser } from './user.entity';

@Injectable({ scope: 'singleton', visibleTo: 'all' })
export class OrmService {
  private readonly logger = new Logger('OrmService');
  private orm!: MikroORM;
  async onInit(): Promise<void> {
    this.orm = await MikroORM.init({
      driver: BunPostgreSqlDriver as any,
      clientUrl: 'postgres://poc:poc@127.0.0.1:55433/pocdb',
      entities: [DbUser], extensions: [SqlSchemaGenerator],
    });
    await this.orm.schema.drop({ dropForeignKeys: true });
    await this.orm.schema.create();
    const em = this.orm.em.fork();
    em.persist(em.create(DbUser, { name: 'Ada Lovelace', email: 'ada@db.io' }));
    em.persist(em.create(DbUser, { name: 'Alan Turing', email: 'alan@db.io' }));
    await em.flush();
    this.logger.info('MikroORM(Bun.SQL/Postgres) initialized + seeded');
  }
  async onDestroy(): Promise<void> { await this.orm?.close(true); }
  em(): EntityManager { return this.orm.em.fork(); }
  repo(): EntityRepository<DbUser> { return this.orm.em.fork().getRepository(DbUser); }
}
