import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MikroORM, type Options } from '@mikro-orm/core';

import { Entity, PrimaryKey, Property } from '../../src/entity';
import { BunPostgreSqlDriver } from '../../src/driver';
import { PG_URL, describePg } from './helpers';

@Entity()
class Item {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string', unique: true })
  code!: string;

  @Property({ type: 'number' })
  qty!: number;
}

describePg('batch + upsert (postgres)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await MikroORM.init({ driver: BunPostgreSqlDriver, clientUrl: PG_URL, entities: [Item] } as unknown as Options);
  });
  afterAll(async () => {
    await orm.close(true);
  });
  beforeEach(async () => {
    const s = orm as unknown as { schema: { drop(o?: { dropForeignKeys?: boolean }): Promise<void>; create(): Promise<void> } };
    await s.schema.drop({ dropForeignKeys: true });
    await s.schema.create();
  });

  test('batch insert persists many entities in one flush', async () => {
    const em = orm.em.fork();
    for (let i = 0; i < 5; i++) {
      em.persist(em.create(Item, { code: `c${i}`, qty: i }));
    }
    await em.flush();
    expect(await orm.em.fork().count(Item, {})).toBe(5);
  });

  test('nativeUpdate reports the number of rows changed', async () => {
    const em = orm.em.fork();
    em.persist(em.create(Item, { code: 'a', qty: 1 }));
    em.persist(em.create(Item, { code: 'b', qty: 1 }));
    await em.flush();
    const changed = await orm.em.fork().nativeUpdate(Item, { qty: 1 }, { qty: 9 });
    expect(changed).toBe(2);
  });

  test('upsert inserts when new then updates on conflict', async () => {
    await orm.em.fork().upsert(Item, { code: 'u', qty: 1 });
    await orm.em.fork().upsert(Item, { code: 'u', qty: 42 });
    const row = await orm.em.fork().findOneOrFail(Item, { code: 'u' });
    expect(row.qty).toBe(42);
    expect(await orm.em.fork().count(Item, { code: 'u' })).toBe(1);
  });

  test('upsertMany inserts/updates a set', async () => {
    await orm.em.fork().upsert(Item, { code: 'm', qty: 1 });
    await orm.em.fork().upsertMany(Item, [
      { code: 'm', qty: 7 },
      { code: 'n', qty: 8 },
    ]);
    const em = orm.em.fork();
    expect((await em.findOneOrFail(Item, { code: 'm' })).qty).toBe(7);
    expect((await em.findOneOrFail(Item, { code: 'n' })).qty).toBe(8);
  });
});
