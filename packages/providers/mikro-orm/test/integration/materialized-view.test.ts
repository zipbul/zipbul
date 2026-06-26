import { test, expect, beforeAll, afterAll } from 'bun:test';
import { MikroORM, type Options } from '@mikro-orm/core';
import { BasePostgreSqlEntityManager } from '@mikro-orm/postgresql';

import { Entity, PrimaryKey, Property } from '../../src/entity';
import { BunPostgreSqlDriver } from '../../src/driver';
import { PG_URL, describePg } from './helpers';

// RED (gap J): the official PostgreSqlDriver overrides createEntityManager to return a
// PostgreSqlEntityManager, which adds pg-only helpers like refreshMaterializedView(). Ours
// used the base SqlEntityManager, so those helpers were absent.
@Entity()
class MvRow {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'number' })
  amount!: number;
}

describePg('PostgreSQL EntityManager (postgres)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await MikroORM.init({ driver: BunPostgreSqlDriver, clientUrl: PG_URL, entities: [MvRow] } as unknown as Options);
  });
  afterAll(async () => {
    await orm.close(true);
  });

  test('the EM is a PostgreSQL-flavoured EntityManager', () => {
    expect(orm.em).toBeInstanceOf(BasePostgreSqlEntityManager);
  });

  test('it exposes the pg-only refreshMaterializedView helper', () => {
    expect(typeof (orm.em as unknown as { refreshMaterializedView?: unknown }).refreshMaterializedView).toBe('function');
  });

  test('refreshMaterializedView actually re-runs a materialized view', async () => {
    const c = orm.em.getConnection();
    await c.execute('drop materialized view if exists mv_totals');
    await c.execute('drop table if exists mv_base cascade');
    await c.execute('create table mv_base (id serial primary key, amount int not null)');
    await c.execute('insert into mv_base (amount) values (10), (20)');
    await c.execute('create materialized view mv_totals as select sum(amount) as total from mv_base');

    // refreshMaterializedView is exercised via the connection's schema helper SQL it builds.
    const helper = (orm.em.getDriver().getPlatform().getSchemaHelper() as unknown as {
      refreshMaterializedView(table: string, schema?: string, concurrently?: boolean): string;
    });
    await c.execute('insert into mv_base (amount) values (5)');
    await c.execute(helper.refreshMaterializedView('mv_totals'));

    const rows = (await c.execute('select total from mv_totals')) as Array<{ total: number }>;
    expect(Number(rows[0]?.total)).toBe(35);

    await c.execute('drop materialized view if exists mv_totals').catch(() => undefined);
    await c.execute('drop table if exists mv_base cascade').catch(() => undefined);
  });
});
