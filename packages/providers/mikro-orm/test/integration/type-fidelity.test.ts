// Force a non-UTC process timezone BEFORE anything else: bun:test runs with TZ=UTC by default,
// which masks the no-tz timestamp/datetime corruption (#1/#4) — those only diverge off-UTC. A
// correct driver must round-trip temporal values regardless of the host process timezone.
process.env.TZ = 'Asia/Seoul';

import { test, expect, beforeAll, afterAll, describe } from 'bun:test';
import { MikroORM, type Options } from '@mikro-orm/core';
import { SqlSchemaGenerator } from '@mikro-orm/sql';

import { Entity, PrimaryKey, Property } from '../../src/entity';
import { BunPostgreSqlDriver, BunMySqlDriver, BunSqliteDriver } from '../../src/driver';
import { PG_URL, MYSQL_URL, describePg, describeMysql } from './helpers';

// C5 type fidelity — defects the conformance hunt confirmed (all silent corruption vs the official
// driver, all rooted in Bun.SQL's protocol-level coercion which exposes no type-parser API):
//   #1 pg `timestamp` (no tz): Bun parses the wall-clock in the PROCESS-local timezone → wrong
//      UTC instant (the official pg type-parser keeps it a raw string, hydrated as UTC).
//   #2 pg `date`: Bun returns a Date object; the official DateType returns a 'YYYY-MM-DD' string.
//   #3 sqlite BIGINT > 2^53: Bun coerces to a JS number → precision loss.
//   #4 mysql/mariadb `datetime`: same TZ shift as #1.
// These tests are TZ-sensitive (#1/#4 only diverge under a non-UTC process TZ); the dev box is KST.

const WALL = '2026-05-30T10:20:30.000Z';

describePg('type fidelity (postgres)', () => {
  @Entity()
  class TfPgRow {
    @PrimaryKey({ type: 'number', autoincrement: true })
    id!: number;

    @Property({ type: 'datetime', columnType: 'timestamp' })
    ts!: Date;

    @Property({ type: 'date' })
    d!: Date;
  }

  let orm: MikroORM;
  beforeAll(async () => {
    orm = await MikroORM.init({
      driver: BunPostgreSqlDriver,
      clientUrl: PG_URL,
      entities: [TfPgRow],
      extensions: [SqlSchemaGenerator],
      forceUtcTimezone: true,
    } as unknown as Options);
    const sg = (orm as unknown as { schema: { drop(o?: { dropForeignKeys?: boolean }): Promise<void>; create(): Promise<void> } }).schema; await sg.drop({ dropForeignKeys: true }); await sg.create();
  });
  afterAll(async () => {
    await orm.close(true);
  });

  test('#1 a no-tz `timestamp` round-trips the exact UTC instant', async () => {
    const em = orm.em.fork();
    const row = em.create(TfPgRow, { ts: new Date(WALL), d: new Date('2026-05-30') });
    em.persist(row); await em.flush();
    const found = await orm.em.fork().findOneOrFail(TfPgRow, { id: row.id });
    expect(found.ts.toISOString()).toBe(WALL);
  });

  test('#2 a `date` column reads back as a YYYY-MM-DD string (official DateType contract)', async () => {
    const em = orm.em.fork();
    const row = em.create(TfPgRow, { ts: new Date(WALL), d: new Date('2026-05-30') });
    em.persist(row); await em.flush();
    const found = await orm.em.fork().findOneOrFail(TfPgRow, { id: row.id });
    expect(found.d as unknown).toBe('2026-05-30');
  });
});

describeMysql('type fidelity (mysql)', () => {
  @Entity()
  class TfMyRow {
    @PrimaryKey({ type: 'number', autoincrement: true })
    id!: number;

    @Property({ type: 'datetime', columnType: 'datetime' })
    dt!: Date;
  }

  let orm: MikroORM;
  beforeAll(async () => {
    orm = await MikroORM.init({
      driver: BunMySqlDriver,
      clientUrl: MYSQL_URL,
      entities: [TfMyRow],
      extensions: [SqlSchemaGenerator],
      forceUtcTimezone: true,
    } as unknown as Options);
    const sg = (orm as unknown as { schema: { drop(o?: { dropForeignKeys?: boolean }): Promise<void>; create(): Promise<void> } }).schema; await sg.drop({ dropForeignKeys: true }); await sg.create();
  });
  afterAll(async () => {
    await orm.close(true);
  });

  test('#4 a `datetime` round-trips the exact UTC instant', async () => {
    const em = orm.em.fork();
    const row = em.create(TfMyRow, { dt: new Date(WALL) });
    em.persist(row); await em.flush();
    const found = await orm.em.fork().findOneOrFail(TfMyRow, { id: row.id });
    expect(found.dt.toISOString()).toBe(WALL);
  });
});

describe('type fidelity (sqlite)', () => {
  @Entity()
  class TfSqRow {
    @PrimaryKey({ type: 'number', autoincrement: true })
    id!: number;

    @Property({ type: 'bigint' })
    big!: string;
  }

  let orm: MikroORM;
  beforeAll(async () => {
    orm = await MikroORM.init({
      driver: BunSqliteDriver,
      dbName: ':memory:',
      entities: [TfSqRow],
      extensions: [SqlSchemaGenerator],
    } as unknown as Options);
    const sg = (orm as unknown as { schema: { drop(o?: { dropForeignKeys?: boolean }): Promise<void>; create(): Promise<void> } }).schema; await sg.drop({ dropForeignKeys: true }); await sg.create();
  });
  afterAll(async () => {
    await orm.close(true);
  });

  test('#3 a BIGINT beyond 2^53 round-trips without precision loss', async () => {
    const big = '9223372036854775807'; // INT64 max, > Number.MAX_SAFE_INTEGER
    const em = orm.em.fork();
    const row = em.create(TfSqRow, { big });
    em.persist(row); await em.flush();
    const found = await orm.em.fork().findOneOrFail(TfSqRow, { id: row.id });
    expect(String(found.big)).toBe(big);
  });
});
