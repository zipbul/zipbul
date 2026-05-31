import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MikroORM, type Options } from '@mikro-orm/core';

import { Entity, PrimaryKey, Property } from '../../src/entity';
import { BunPostgreSqlDriver } from '../../src/driver';
import { PG_URL, describePg } from './helpers';

// HIGHEST-RISK unverified bucket: Bun.SQL does its OWN type coercion (no MikroORM type-parser
// control), so these may come back as the wrong JS type and corrupt silently. Each test
// persists then re-reads via a FRESH fork (bypassing identity-map cache) and asserts the
// round-trip type+value.

@Entity()
class TypeRow {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'Date' })
  when!: Date;

  @Property({ type: 'json' })
  data!: { tags: string[]; n: number };

  @Property({ type: 'bigint' })
  big!: string;

  @Property({ type: 'decimal', precision: 14, scale: 4 })
  amount!: string;

  @Property({ type: 'boolean' })
  flag!: boolean;

  @Property({ type: 'string[]' })
  tags!: string[];

  @Property({ type: 'uuid' })
  uid!: string;
}

describePg('type conversion round-trip (postgres)', () => {
  let orm: MikroORM;
  const WHEN = new Date('2026-05-30T10:20:30.000Z');
  const UID = '11111111-2222-3333-4444-555555555555';

  beforeAll(async () => {
    orm = await MikroORM.init({
      driver: BunPostgreSqlDriver,
      clientUrl: PG_URL,
      entities: [TypeRow],
    } as unknown as Options);
  });
  afterAll(async () => {
    await orm.close(true);
  });
  beforeEach(async () => {
    const s = orm as unknown as { schema: { drop(o?: { dropForeignKeys?: boolean }): Promise<void>; create(): Promise<void> } };
    await s.schema.drop({ dropForeignKeys: true });
    await s.schema.create();
    const em = orm.em.fork();
    em.persist(
      em.create(TypeRow, {
        when: WHEN,
        data: { tags: ['a', 'b'], n: 7 },
        big: '9007199254740993',
        amount: '1234.5678',
        flag: true,
        tags: ['x', 'y', 'z'],
        uid: UID,
      }),
    );
    await em.flush();
  });

  const read = () => orm.em.fork().findOneOrFail(TypeRow, { uid: UID });

  test('Date round-trips as a Date with the same instant', async () => {
    const row = await read();
    expect(row.when).toBeInstanceOf(Date);
    expect(row.when.toISOString()).toBe(WHEN.toISOString());
  });

  test('json round-trips as a structured object', async () => {
    const row = await read();
    expect(row.data).toEqual({ tags: ['a', 'b'], n: 7 });
  });

  test('bigint round-trips without precision loss (>MAX_SAFE_INTEGER)', async () => {
    const row = await read();
    expect(String(row.big)).toBe('9007199254740993');
  });

  test('decimal round-trips exactly as a string', async () => {
    const row = await read();
    expect(row.amount).toBe('1234.5678');
  });

  test('boolean round-trips as a JS boolean', async () => {
    const row = await read();
    expect(row.flag).toBe(true);
  });

  test('string array round-trips as a JS array', async () => {
    const row = await read();
    expect(row.tags).toEqual(['x', 'y', 'z']);
  });

  test('uuid round-trips as a string', async () => {
    const row = await read();
    expect(row.uid).toBe(UID);
  });
});
