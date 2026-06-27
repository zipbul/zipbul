import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MikroORM, type Options } from '@mikro-orm/core';

import { Entity, PrimaryKey, Property, Enum } from '../../src/entity';
import { BunPostgreSqlDriver } from '../../src/driver';
import { PG_URL, describePg } from './helpers';

enum Color {
  Red = 'red',
  Blue = 'blue',
}

@Entity()
class EdgeRow {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'integer[]' })
  nums!: number[];

  @Enum({ items: () => Color })
  color!: Color;

  @Property({ type: 'blob', nullable: true })
  blob?: Buffer;
}

describePg('edge type conversion (postgres)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await MikroORM.init({ driver: BunPostgreSqlDriver, clientUrl: PG_URL, entities: [EdgeRow] } as unknown as Options);
  });
  afterAll(async () => {
    await orm.close(true);
  });
  beforeEach(async () => {
    const s = orm as unknown as { schema: { drop(o?: { dropForeignKeys?: boolean }): Promise<void>; create(): Promise<void> } };
    await s.schema.drop({ dropForeignKeys: true });
    await s.schema.create();
  });

  // NUANCE (type-parser-control loss): Bun.SQL returns int[] as a real number array
  // [1,2,3], but MikroORM's default ArrayType for `integer[]` yields STRING elements
  // (["1","2","3"]) because there's no OID type parser to coerce. The array structure +
  // values round-trip intact; for native number elements a typed ArrayType is needed.
  test('integer array round-trips with intact values (default element type is string)', async () => {
    const em = orm.em.fork();
    const r = em.create(EdgeRow, { nums: [1, 2, 3], color: Color.Red });
    em.persist(r);
    await em.flush();
    const found = await orm.em.fork().findOneOrFail(EdgeRow, { id: r.id });
    // Bun.SQL exposes no type-parser hook, so an `integer[]` column hydrates as STRING elements
    // (values intact). This is a documented Bun.SQL divergence from the official pg driver (which
    // parses to numbers) — assert the actual string shape rather than coercing it away with Number().
    expect(found.nums as unknown as string[]).toEqual(['1', '2', '3']);
  });

  test('enum round-trips as its value', async () => {
    const em = orm.em.fork();
    const r = em.create(EdgeRow, { nums: [], color: Color.Blue });
    em.persist(r);
    await em.flush();
    const found = await orm.em.fork().findOneOrFail(EdgeRow, { id: r.id });
    expect(found.color).toBe(Color.Blue);
  });

  test('bytea/Buffer round-trips with identical bytes', async () => {
    const em = orm.em.fork();
    const bytes = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const r = em.create(EdgeRow, { nums: [], color: Color.Red, blob: bytes });
    em.persist(r);
    await em.flush();
    const found = await orm.em.fork().findOneOrFail(EdgeRow, { id: r.id });
    expect(Buffer.from(found.blob!).equals(bytes)).toBe(true);
  });
});
