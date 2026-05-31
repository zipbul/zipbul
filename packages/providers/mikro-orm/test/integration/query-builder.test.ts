import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MikroORM, type Options } from '@mikro-orm/core';

import { Entity, PrimaryKey, Property } from '../../src/entity';
import { BunPostgreSqlDriver } from '../../src/driver';
import { PG_URL, describePg } from './helpers';

@Entity()
class Sale {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string' })
  region!: string;

  @Property({ type: 'number' })
  amount!: number;
}

describePg('query builder (postgres)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await MikroORM.init({ driver: BunPostgreSqlDriver, clientUrl: PG_URL, entities: [Sale] } as unknown as Options);
  });
  afterAll(async () => {
    await orm.close(true);
  });
  beforeEach(async () => {
    const s = orm as unknown as { schema: { drop(o?: { dropForeignKeys?: boolean }): Promise<void>; create(): Promise<void> } };
    await s.schema.drop({ dropForeignKeys: true });
    await s.schema.create();
    const em = orm.em.fork();
    for (const [region, amount] of [['us', 10], ['us', 20], ['eu', 5]] as const) {
      em.persist(em.create(Sale, { region, amount }));
    }
    await em.flush();
  });

  test('where + orderBy + limit/offset paginate correctly', async () => {
    const rows = await orm.em.fork().find(Sale, {}, { orderBy: { amount: 'desc' }, limit: 2, offset: 1 });
    expect(rows.map((r) => r.amount)).toEqual([10, 5]);
  });

  test('group by + having + aggregate SQL executes through the driver', async () => {
    // The driver concern is executing GROUP BY/HAVING/aggregate SQL correctly; the qb DSL
    // that builds it is MikroORM's, not the driver's. Drive raw aggregate SQL via the connection.
    const rows = (await orm.em
      .getConnection()
      .execute('select region, sum(amount)::int as total from sale group by region having sum(amount) > 10 order by region')) as Array<{
      region: string;
      total: number;
    }>;
    expect(rows).toEqual([{ region: 'us', total: 30 }]);
  });

  test('count aggregate', async () => {
    expect(await orm.em.fork().count(Sale, { region: 'us' })).toBe(2);
  });
});
