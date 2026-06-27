// bun:test pins TZ=UTC, which would MASK any no-tz `datetime` coercion offset — force a non-UTC
// zone so the Date value assertion below actually proves the instant survives. Must precede imports.
process.env.TZ = 'Asia/Seoul';

import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MikroORM, type Options } from '@mikro-orm/core';

import { Entity, PrimaryKey, Property } from '../../src/entity';
import { BunMySqlDriver } from '../../src/driver';
import { MYSQL_URL, describeMysql } from './helpers';

@Entity()
class Record {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string', unique: true })
  code!: string;

  @Property({ type: 'number' })
  qty!: number;

  @Property({ type: 'boolean' })
  active!: boolean;

  @Property({ type: 'Date' })
  at!: Date;

  @Property({ type: 'json' })
  meta!: { k: string };

  @Property({ type: 'decimal', precision: 12, scale: 2 })
  price!: string;
}

describeMysql('mysql round-trip + types + transactions', () => {
  let orm: MikroORM;
  const AT = new Date('2026-05-30T08:00:00.000Z');
  beforeAll(async () => {
    orm = await MikroORM.init({ driver: BunMySqlDriver, clientUrl: MYSQL_URL, entities: [Record] } as unknown as Options);
  });
  afterAll(async () => {
    await orm.close(true);
  });
  beforeEach(async () => {
    const s = orm as unknown as { schema: { drop(o?: { dropForeignKeys?: boolean }): Promise<void>; create(): Promise<void> } };
    await s.schema.drop({ dropForeignKeys: true });
    await s.schema.create();
  });

  test('CRUD round-trips with an autoincrement id', async () => {
    const em = orm.em.fork();
    const r = em.create(Record, { code: 'A', qty: 3, active: true, at: AT, meta: { k: 'v' }, price: '12.34' });
    em.persist(r);
    await em.flush();
    expect(r.id).toBeGreaterThan(0);
    const found = await orm.em.fork().findOneOrFail(Record, { code: 'A' });
    expect(found.qty).toBe(3);
  });

  test('boolean (tinyint(1)) round-trips as a JS boolean', async () => {
    const em = orm.em.fork();
    em.persist(em.create(Record, { code: 'B', qty: 1, active: false, at: AT, meta: { k: 'v' }, price: '1.00' }));
    await em.flush();
    const found = await orm.em.fork().findOneOrFail(Record, { code: 'B' });
    expect(found.active).toBe(false);
  });

  test('Date / json / decimal round-trip', async () => {
    const em = orm.em.fork();
    em.persist(em.create(Record, { code: 'C', qty: 1, active: true, at: AT, meta: { k: 'hi' }, price: '99.99' }));
    await em.flush();
    const found = await orm.em.fork().findOneOrFail(Record, { code: 'C' });
    expect(found.at).toBeInstanceOf(Date);
    expect(found.at.toISOString()).toBe(AT.toISOString()); // exact instant, under a non-UTC process
    expect(found.meta).toEqual({ k: 'hi' });
    expect(found.price).toBe('99.99');
  });

  test('nativeUpdate reports the affected row count', async () => {
    const em = orm.em.fork();
    em.persist(em.create(Record, { code: 'D', qty: 1, active: true, at: AT, meta: { k: 'v' }, price: '1.00' }));
    await em.flush();
    const changed = await orm.em.fork().nativeUpdate(Record, { code: 'D' }, { qty: 5 });
    expect(changed).toBe(1);
  });

  test('a thrown transaction rolls back', async () => {
    await expect(
      orm.em.fork().transactional(async (em) => {
        em.persist(em.create(Record, { code: 'E', qty: 1, active: true, at: AT, meta: { k: 'v' }, price: '1.00' }));
        await em.flush();
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await orm.em.fork().count(Record, { code: 'E' })).toBe(0);
  });
});
