import { test, expect, beforeAll, afterAll } from 'bun:test';
import { MikroORM, Routine, type Options } from '@mikro-orm/core';

import { Entity, PrimaryKey } from '../../src/entity';
import { BunSqliteDriver } from '../../src/driver';

// Gap C (sqlite): SQLite has no procedures, and the official driver bridges functions via a
// better-sqlite3 UDF (database.function). Bun.SQL exposes no UDF-registration API, so both
// paths raise accurate, actionable errors rather than the generic core "not supported".
@Entity()
class RtSqRow {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;
}

const Proc = new Routine({
  name: 'sq_proc',
  type: 'procedure',
  params: { a: { type: 'int', runtimeType: 'number' } },
  body: 'noop',
});

const Fn = new Routine({
  name: 'sq_fn',
  type: 'function',
  params: { a: { type: 'int', runtimeType: 'number' } },
  returns: { runtimeType: 'number', columnType: 'int' },
  bodyJs: ({ a }: { a: number }) => a * 2,
});

let orm: MikroORM;
beforeAll(async () => {
  orm = await MikroORM.init({
    driver: BunSqliteDriver,
    dbName: ':memory:',
    entities: [RtSqRow],
    routines: [Proc, Fn],
  } as unknown as Options);
});
afterAll(async () => {
  await orm.close(true);
});

test('rejects stored procedures with a SQLite-specific message', async () => {
  await expect(orm.em.callRoutine(Proc, { a: 1 })).rejects.toThrow(/Stored procedures are not supported on SQLite/);
});

test('rejects function routines because Bun.SQL has no UDF registration API', async () => {
  await expect(orm.em.callRoutine(Fn, { a: 1 })).rejects.toThrow(/no user-defined-function registration API/);
});
