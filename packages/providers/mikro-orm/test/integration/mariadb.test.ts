// MariaDB runs through BunMariaDbDriver (extends BunMySqlDriver). bun:test forces TZ=UTC, which
// would MASK the no-tz datetime coercion bug — force a non-UTC zone so the BunUtcDateTimeType fix
// (shared via withBunMySqlFixes) is actually exercised. Must precede any Date construction.
process.env.TZ = 'Asia/Seoul';

import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { Collection, MikroORM, type Options, LoadStrategy } from '@mikro-orm/core';
import type { SqlEntityManager } from '@mikro-orm/sql';

import { Entity, PrimaryKey, Property, OneToMany, ManyToOne } from '../../src/entity';
import { BunMariaDbDriver } from '../../src/driver';
import { MARIADB_URL, describeMariadb } from './helpers';

@Entity()
class MaRecord {
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

  @Property({ type: 'bigint' })
  big!: bigint;
}

@Entity()
class MaAuthor {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string' })
  name!: string;

  @OneToMany({ entity: () => MaBook, mappedBy: 'author' })
  books = new Collection<MaBook>(this);
}

@Entity()
class MaBook {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string' })
  title!: string;

  @ManyToOne({ entity: () => MaAuthor })
  author!: MaAuthor;
}

type RecData = { code: string; qty: number; active: boolean; at: Date; meta: { k: string }; price: string; big: bigint };

describeMariadb('mariadb driver — round-trip, types, side-effects, pagination', () => {
  let orm: MikroORM;
  const AT = new Date('2026-05-30T08:00:00.000Z');
  const base: RecData = { code: 'A', qty: 3, active: true, at: AT, meta: { k: 'v' }, price: '12.34', big: 9007199254740993n };
  const rec = (over: Partial<RecData> = {}): RecData => ({ ...base, ...over });

  beforeAll(async () => {
    orm = await MikroORM.init({
      driver: BunMariaDbDriver,
      clientUrl: MARIADB_URL,
      entities: [MaRecord, MaAuthor, MaBook],
    } as unknown as Options);
  });
  afterAll(async () => {
    await orm.close(true);
  });
  beforeEach(async () => {
    const s = orm as unknown as { schema: { drop(o?: { dropForeignKeys?: boolean }): Promise<void>; create(): Promise<void> } };
    await s.schema.drop({ dropForeignKeys: true });
    await s.schema.create();
  });

  // --- happy path ---------------------------------------------------------
  test('CRUD round-trips with an autoincrement id', async () => {
    const em = orm.em.fork();
    const r = em.create(MaRecord, rec());
    em.persist(r);
    await em.flush();
    expect(r.id).toBeGreaterThan(0);
    expect((await orm.em.fork().findOneOrFail(MaRecord, { code: 'A' })).qty).toBe(3);
  });

  // --- type fidelity (Bun.SQL coercion corrections) -----------------------
  test('boolean (tinyint(1)) round-trips as a JS boolean', async () => {
    const em = orm.em.fork();
    em.persist(em.create(MaRecord, rec({ code: 'B', active: false })));
    await em.flush();
    expect((await orm.em.fork().findOneOrFail(MaRecord, { code: 'B' })).active).toBe(false);
  });

  test('json column round-trips as an object (MariaDB LONGTEXT via Bun.SQL raw string)', async () => {
    const em = orm.em.fork();
    em.persist(em.create(MaRecord, rec({ code: 'J', meta: { k: 'hi' } })));
    await em.flush();
    expect((await orm.em.fork().findOneOrFail(MaRecord, { code: 'J' })).meta).toEqual({ k: 'hi' });
  });

  test('decimal round-trips as an exact string', async () => {
    const em = orm.em.fork();
    em.persist(em.create(MaRecord, rec({ code: 'P', price: '99.99' })));
    await em.flush();
    expect((await orm.em.fork().findOneOrFail(MaRecord, { code: 'P' })).price).toBe('99.99');
  });

  test('bigint past 2^53 round-trips as a JS bigint without precision loss (v7 BigIntType default)', async () => {
    const em = orm.em.fork();
    em.persist(em.create(MaRecord, rec({ code: 'G', big: 9007199254740993n })));
    await em.flush();
    expect((await orm.em.fork().findOneOrFail(MaRecord, { code: 'G' })).big).toBe(9007199254740993n);
  });

  test('no-tz datetime keeps the exact UTC instant under a non-UTC process timezone', async () => {
    expect(process.env.TZ).toBe('Asia/Seoul');
    const em = orm.em.fork();
    em.persist(em.create(MaRecord, rec({ code: 'T', at: AT })));
    await em.flush();
    const found = await orm.em.fork().findOneOrFail(MaRecord, { code: 'T' });
    expect(found.at).toBeInstanceOf(Date);
    expect(found.at.toISOString()).toBe(AT.toISOString());
  });

  // --- side-effects -------------------------------------------------------
  test('batch insert of several new entities back-fills each distinct PK (no RETURNING)', async () => {
    const em = orm.em.fork();
    const rows = ['M1', 'M2', 'M3'].map((code) => em.create(MaRecord, rec({ code })));
    rows.forEach((r) => em.persist(r));
    await em.flush();
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(3);
    ids.forEach((id) => expect(id).toBeGreaterThan(0));
  });

  test('nativeUpdate reports the affected row count', async () => {
    const em = orm.em.fork();
    em.persist(em.create(MaRecord, rec({ code: 'U' })));
    await em.flush();
    expect(await orm.em.fork().nativeUpdate(MaRecord, { code: 'U' }, { qty: 5 })).toBe(1);
  });

  test('nativeDelete reports the affected row count', async () => {
    const em = orm.em.fork();
    em.persist(em.create(MaRecord, rec({ code: 'D' })));
    await em.flush();
    expect(await orm.em.fork().nativeDelete(MaRecord, { code: 'D' })).toBe(1);
  });

  // --- transactions -------------------------------------------------------
  test('a thrown transaction rolls back', async () => {
    await expect(
      orm.em.fork().transactional(async (em) => {
        em.persist(em.create(MaRecord, rec({ code: 'X' })));
        await em.flush();
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await orm.em.fork().count(MaRecord, { code: 'X' })).toBe(0);
  });

  // --- negative / edge ----------------------------------------------------
  test('find on an empty table returns an empty array and count 0', async () => {
    expect(await orm.em.fork().find(MaRecord, {})).toEqual([]);
    expect(await orm.em.fork().count(MaRecord, {})).toBe(0);
  });

  // --- MariaDB-specific QueryBuilder divergence ---------------------------
  test('paginated find with a JOINED to-many populate returns correct rows (MariaDbQueryBuilder)', async () => {
    const em = orm.em.fork();
    for (const name of ['Ann', 'Bob', 'Cy']) {
      const author = em.create(MaAuthor, { name });
      em.persist(author);
      for (let i = 0; i < 3; i++) {
        em.persist(em.create(MaBook, { title: `${name}-${i}`, author }));
      }
    }
    await em.flush();

    const page = await orm.em.fork().find(
      MaAuthor,
      {},
      { populate: ['books'], strategy: LoadStrategy.JOINED, orderBy: { name: 'asc' }, limit: 2 },
    );
    expect(page.map((a) => a.name)).toEqual(['Ann', 'Bob']);
    expect(page.every((a) => a.books.isInitialized() && a.books.length === 3)).toBe(true);
  });

  test('the driver wires the MariaDB-specific query builder', () => {
    const em = orm.em.fork() as unknown as SqlEntityManager;
    expect(em.createQueryBuilder(MaRecord).constructor.name).toBe('MariaDbQueryBuilder');
  });
});
