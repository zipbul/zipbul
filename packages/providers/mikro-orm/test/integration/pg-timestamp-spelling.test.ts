// Bun.SQL parses a no-tz `timestamp` in the process timezone; BunPostgreSqlPlatform remaps it to
// BunUtcDateTimeType so the instant matches the official pg driver. That remap must fire for BOTH
// the short spelling (`timestamp`) and the canonical `timestamp without time zone` that database
// introspection / EntityGenerator emit — otherwise the canonical form silently regresses by the
// host-timezone offset. `timestamptz` is excluded (Bun returns a correct absolute instant).
process.env.TZ = 'Asia/Seoul';

import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MikroORM, type Options } from '@mikro-orm/core';
import { SqlSchemaGenerator } from '@mikro-orm/sql';

import { Entity, PrimaryKey, Property } from '../../src/entity';
import { BunPostgreSqlDriver } from '../../src/driver';
import { PG_URL, describePg } from './helpers';

@Entity()
class TsSpell {
  @PrimaryKey({ type: 'number', autoincrement: true }) id!: number;
  // canonical spelling, as introspection emits it
  @Property({ type: 'datetime', columnType: 'timestamp without time zone' }) atCanonical!: Date;
  // short spelling
  @Property({ type: 'datetime', columnType: 'timestamp' }) atShort!: Date;
  // tz-aware control: must stay a correct absolute instant either way
  @Property({ type: 'datetime', columnType: 'timestamptz' }) atTz!: Date;
}

describePg('pg no-tz timestamp spelling fidelity (postgres)', () => {
  let orm: MikroORM;
  const AT = new Date('2026-05-30T08:00:00.000Z');
  beforeAll(async () => {
    orm = await MikroORM.init({ driver: BunPostgreSqlDriver, clientUrl: PG_URL, entities: [TsSpell], extensions: [SqlSchemaGenerator] } as unknown as Options);
  });
  afterAll(async () => {
    await orm.close(true);
  });
  beforeEach(async () => {
    const s = orm as unknown as { schema: { drop(o?: { dropForeignKeys?: boolean }): Promise<void>; create(): Promise<void> } };
    await s.schema.drop({ dropForeignKeys: true });
    await s.schema.create();
  });

  test('canonical, short, and tz-aware timestamps all round-trip to the exact UTC instant under a non-UTC process', async () => {
    expect(process.env.TZ).toBe('Asia/Seoul');
    const em = orm.em.fork();
    const row = em.create(TsSpell, { atCanonical: AT, atShort: AT, atTz: AT });
    em.persist(row);
    await em.flush();
    const found = await orm.em.fork().findOneOrFail(TsSpell, { id: row.id });
    expect(found.atCanonical.toISOString()).toBe(AT.toISOString());
    expect(found.atShort.toISOString()).toBe(AT.toISOString());
    expect(found.atTz.toISOString()).toBe(AT.toISOString());
  });
});
