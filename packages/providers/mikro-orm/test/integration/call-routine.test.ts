import { test, expect, beforeAll, afterAll } from 'bun:test';
import { MikroORM, Routine, ScalarReference, type Options } from '@mikro-orm/core';

import { Entity, PrimaryKey } from '../../src/entity';
import { BunPostgreSqlDriver } from '../../src/driver';
import { PG_URL, describePg } from './helpers';

// RED (gap C): the official PostgreSqlConnection overrides callRoutine to dispatch scalar
// functions (`select fn(...)`) and procedures (`call proc(...)` with OUT params + refcursors).
// Our connections extended AbstractSqlConnection, which inherits the core base that throws
// "Stored routines are not supported by the current driver". em.callRoutine was unusable.
@Entity()
class RtRow {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;
}

const AddFn = new Routine({
  name: 'bun_add',
  type: 'function',
  params: { a: { type: 'int', runtimeType: 'number' }, b: { type: 'int', runtimeType: 'number' } },
  returns: { runtimeType: 'number', columnType: 'int' },
  body: 'select a + b',
});

const SumProc = new Routine({
  name: 'bun_sum_proc',
  type: 'procedure',
  params: {
    a: { type: 'int', runtimeType: 'number' },
    b: { type: 'int', runtimeType: 'number' },
    out_total: { type: 'int', runtimeType: 'number', direction: 'out', ref: true },
  },
  body: 'begin out_total := a + b; end',
});

const PairCursor = Routine.create<Record<string, never>, unknown[][]>({
  name: 'bun_pairs',
  type: 'procedure',
  params: { c: { type: 'refcursor', runtimeType: 'any', direction: 'out', ref: true } },
  body: 'begin open c for select 1 as n union all select 2 order by n; end',
});

describePg('callRoutine (postgres)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await MikroORM.init({
      driver: BunPostgreSqlDriver,
      clientUrl: PG_URL,
      entities: [RtRow],
      routines: [AddFn, SumProc, PairCursor],
    } as unknown as Options);
    const c = orm.em.getConnection();
    await c.execute('create or replace function bun_add(a int, b int) returns int language sql as $$ select a + b $$');
    await c.execute(
      `create or replace procedure bun_sum_proc(a int, b int, out out_total int) language plpgsql as $$ begin out_total := a + b; end $$`,
    );
    await c.execute(
      `create or replace procedure bun_pairs(out c refcursor) language plpgsql as $$ begin open c for select 1 as n union all select 2 order by n; end $$`,
    );
  });
  afterAll(async () => {
    const c = orm.em.getConnection();
    await c.execute('drop function if exists bun_add(int, int)').catch(() => undefined);
    await c.execute('drop procedure if exists bun_sum_proc(int, int, int)').catch(() => undefined);
    await c.execute('drop procedure if exists bun_pairs(refcursor)').catch(() => undefined);
    await orm.close(true);
  });

  test('invokes a scalar function via select fn(...)', async () => {
    const result = await orm.em.callRoutine(AddFn, { a: 3, b: 4 });
    expect(Number(result)).toBe(7);
  });

  test('invokes a procedure and writes back the OUT param', async () => {
    const out = new ScalarReference<number>(null as unknown as number, false);
    await orm.em.callRoutine(SumProc, { a: 10, b: 5, out_total: out } as never);
    expect(Number(out.unwrap())).toBe(15);
  });

  test('fetches a refcursor OUT param inside a transaction', async () => {
    const sets = await orm.em.fork().transactional((em) => em.callRoutine(PairCursor, {}));
    expect(Array.isArray(sets)).toBe(true);
    const rows = (sets as Array<Array<{ n: number }>>)[0] ?? [];
    expect(rows.map((r) => Number(r.n))).toEqual([1, 2]);
  });
});
