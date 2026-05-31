import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { MikroORM } from '@mikro-orm/core';

import { Entity, PrimaryKey, Property } from '../../src/entity';
import { BunMySqlDriver } from '../../src/driver';
import { MYSQL_URL, describeMysql, makeOrm, freshSchema } from './helpers';

// RED (gap K): MySQL has no RETURNING, so a multi-row INSERT only reports the FIRST
// auto-increment id. The official MySqlDriver overrides nativeInsertMany to compute the
// rest via `insertId + idx * auto_increment_increment`. Ours did not, so a batch persist
// (multiple new entities flushed together) threw `res.rows[i][field] is undefined`.
@Entity()
class BatchItem {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string' })
  name!: string;
}

describeMysql('batch insert (mysql)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await makeOrm(BunMySqlDriver, MYSQL_URL!, [BatchItem]);
  });
  afterAll(async () => {
    await orm.close(true);
  });
  beforeEach(async () => {
    await freshSchema(orm);
  });

  test('flushing several new entities together assigns each a distinct auto-increment id', async () => {
    const em = orm.em.fork();
    const a = em.create(BatchItem, { name: 'a' });
    const b = em.create(BatchItem, { name: 'b' });
    const c = em.create(BatchItem, { name: 'c' });
    em.persist([a, b, c]);
    await em.flush();

    expect(a.id).toBeGreaterThan(0);
    expect(b.id).toBe(a.id + 1);
    expect(c.id).toBe(a.id + 2);

    const all = await orm.em.fork().find(BatchItem, {}, { orderBy: { id: 'asc' } });
    expect(all.map((r) => r.name)).toEqual(['a', 'b', 'c']);
  });

  test('insertMany via nativeInsertMany returns the inserted rows', async () => {
    const em = orm.em.fork();
    for (let i = 0; i < 5; i++) em.create(BatchItem, { name: `n${i}` });
    await em.flush();
    expect(await orm.em.fork().count(BatchItem, {})).toBe(5);
  });
});
