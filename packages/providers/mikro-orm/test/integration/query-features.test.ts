import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MikroORM } from '@mikro-orm/core';
import type { SqlEntityManager } from '@mikro-orm/sql';

import { Entity, PrimaryKey, Property } from '../../src/entity';
import { BunPostgreSqlDriver } from '../../src/driver';
import { PG_URL, describePg, makeOrm, freshSchema } from './helpers';

@Entity()
class Page {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'number' })
  seq!: number;
}

describePg('cursor pagination + raw em.execute (postgres)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await makeOrm(BunPostgreSqlDriver, PG_URL!, [Page]);
  });
  afterAll(async () => {
    await orm.close(true);
  });
  beforeEach(async () => {
    await freshSchema(orm);
    const em = orm.em.fork();
    for (let i = 1; i <= 5; i++) em.create(Page, { seq: i });
    await em.flush();
  });

  test('findByCursor paginates forward with keyset cursors', async () => {
    const first = await orm.em.fork().findByCursor(Page, { first: 2, orderBy: { seq: 'asc' } });
    expect(first.items.map((p) => p.seq)).toEqual([1, 2]);
    expect(first.hasNextPage).toBe(true);
    expect(first.totalCount).toBe(5);

    const second = await orm.em.fork().findByCursor(Page, {
      first: 2,
      orderBy: { seq: 'asc' },
      ...(first.endCursor != null ? { after: first.endCursor } : {}),
    });
    expect(second.items.map((p) => p.seq)).toEqual([3, 4]);
  });

  test('em.execute runs raw SQL and maps the rows', async () => {
    const em = orm.em.fork() as unknown as SqlEntityManager;
    const rows = (await em.execute('select seq from page order by seq desc limit 1')) as Array<{ seq: number }>;
    expect(rows[0]?.seq).toBe(5);
  });
});
