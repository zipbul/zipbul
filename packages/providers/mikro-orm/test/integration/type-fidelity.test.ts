// Force a non-UTC process timezone BEFORE anything else: bun:test runs with TZ=UTC by default,
// which masks the no-tz timestamp/datetime corruption (#1/#4) — those only diverge off-UTC. A
// correct driver must round-trip temporal values regardless of the host process timezone.
process.env.TZ = 'Asia/Seoul';

import { test, expect, beforeAll, afterAll, describe } from 'bun:test';
import { MikroORM, type Options } from '@mikro-orm/core';
import { SqlSchemaGenerator } from '@mikro-orm/sql';

import { Entity, PrimaryKey, Property } from '../../src/entity';
import { BunPostgreSqlDriver, BunMySqlDriver, BunMariaDbDriver, BunSqliteDriver } from '../../src/driver';
import { PG_URL, MYSQL_URL, MARIADB_URL, describePg, describeMysql, describeMariadb } from './helpers';

// C5 type fidelity — defects the conformance hunt confirmed (all silent corruption vs the official
// driver, all rooted in Bun.SQL's protocol-level coercion which exposes no type-parser API):
//   #1 pg `timestamp` (no tz): Bun parses the wall-clock in the PROCESS-local timezone → wrong
//      UTC instant (the official pg type-parser keeps it a raw string, hydrated as UTC).
//   #2 pg `date`: Bun returns a Date object; the official DateType returns a 'YYYY-MM-DD' string.
//   #3 sqlite BIGINT > 2^53: Bun coerces to a JS number → precision loss.
//   #4 mysql/mariadb `datetime`: same TZ shift as #1.
//   #6 mysql/mariadb `date`: Bun returns a Date object; official mysql2 (dateStrings) → 'YYYY-MM-DD'.
//   #8 mysql/mariadb `year`: Bun returns a string; official mysql2 → a number.
// These tests are TZ-sensitive (#1/#4 only diverge under a non-UTC process TZ; #6 catches a regression
// to local date getters, which break under a positive-offset TZ); the dev box is KST.

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

// One entity class per `MikroORM.init` (sharing one across inits hangs metadata processing — see
// helpers.ts), so MySQL and MariaDB get distinct classes via this factory.
function makeTfRow() {
  @Entity()
  class TfRow {
    @PrimaryKey({ type: 'number', autoincrement: true })
    id!: number;

    @Property({ type: 'datetime', columnType: 'datetime' })
    dt!: Date;

    @Property({ type: 'datetime', columnType: 'timestamp' })
    tsp!: Date;

    @Property({ type: 'date' })
    d!: Date;

    @Property({ type: 'date', nullable: true })
    dn?: Date | null;

    @Property({ type: 'smallint', columnType: 'year' })
    y!: number;

    @Property({ type: 'smallint', columnType: 'year', nullable: true })
    yn?: number | null;
  }
  return TfRow;
}

// The MySQL family (MySQL + MariaDB) shares identical Bun.SQL type-fidelity behaviour, so both lanes
// run the same assertions against their own driver/URL and a distinct entity class.
function mysqlFamilyLane(label: string, driver: typeof BunMySqlDriver, url: string | undefined) {
  const TfRow = makeTfRow();
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await MikroORM.init({
      driver,
      clientUrl: url,
      entities: [TfRow],
      extensions: [SqlSchemaGenerator],
      forceUtcTimezone: true,
    } as unknown as Options);
    const sg = (orm as unknown as { schema: { drop(o?: { dropForeignKeys?: boolean }): Promise<void>; create(): Promise<void> } }).schema; await sg.drop({ dropForeignKeys: true }); await sg.create();
  });
  afterAll(async () => {
    await orm.close(true);
  });

  const seed = () => ({ dt: new Date(WALL), tsp: new Date(WALL), d: new Date('2026-05-30'), y: 2026 });

  test(`#4 (${label}) a \`datetime\` round-trips the exact UTC instant`, async () => {
    const em = orm.em.fork();
    const row = em.create(TfRow, seed());
    em.persist(row); await em.flush();
    const found = await orm.em.fork().findOneOrFail(TfRow, { id: row.id });
    expect(found.dt.toISOString()).toBe(WALL);
  });

  test(`#5 (${label}) a \`timestamp\` round-trips the exact UTC instant`, async () => {
    const em = orm.em.fork();
    const row = em.create(TfRow, seed());
    em.persist(row); await em.flush();
    const found = await orm.em.fork().findOneOrFail(TfRow, { id: row.id });
    expect(found.tsp.toISOString()).toBe(WALL);
  });

  test(`#6 (${label}) a \`date\` reads back as a YYYY-MM-DD string (official DateType contract)`, async () => {
    const em = orm.em.fork();
    const row = em.create(TfRow, seed());
    em.persist(row); await em.flush();
    const found = await orm.em.fork().findOneOrFail(TfRow, { id: row.id });
    expect(found.d as unknown).toBe('2026-05-30');
  });

  test(`#7 (${label}) a NULL \`date\` reads back as null`, async () => {
    const em = orm.em.fork();
    const row = em.create(TfRow, seed());
    em.persist(row); await em.flush();
    const found = await orm.em.fork().findOneOrFail(TfRow, { id: row.id });
    expect(found.dn ?? null).toBeNull();
  });

  test(`#8 (${label}) a \`year\` reads back as a number (matches official mysql2)`, async () => {
    const em = orm.em.fork();
    const row = em.create(TfRow, seed());
    em.persist(row); await em.flush();
    const found = await orm.em.fork().findOneOrFail(TfRow, { id: row.id });
    expect(found.y).toBe(2026);
    expect(typeof found.y).toBe('number');
  });

  test(`#9 (${label}) a NULL \`year\` reads back as null (not coerced to 0)`, async () => {
    const em = orm.em.fork();
    const row = em.create(TfRow, seed());
    em.persist(row); await em.flush();
    const found = await orm.em.fork().findOneOrFail(TfRow, { id: row.id });
    expect(found.yn ?? null).toBeNull();
  });
}

describeMysql('type fidelity (mysql)', () => {
  mysqlFamilyLane('mysql', BunMySqlDriver, MYSQL_URL);
});

describeMariadb('type fidelity (mariadb)', () => {
  mysqlFamilyLane('mariadb', BunMariaDbDriver, MARIADB_URL);
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
