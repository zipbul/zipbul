import { test, expect, beforeAll, afterAll } from 'bun:test';
import { MikroORM, Routine, ScalarReference, type Options } from '@mikro-orm/core';

import { Entity, PrimaryKey } from '../../src/entity';
import { BunMariaDbDriver } from '../../src/driver';
import { MARIADB_URL, describeMariadb } from './helpers';

// MariaDB callRoutine rides the inherited BunMySqlConnection.callRoutine (scalar fn via select,
// procedure OUT params via connection-scoped @vars) — MariaDB speaks the MySQL protocol.
@Entity()
class RtMaRow {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;
}

const AddFn = new Routine({
  name: 'bun_ma_add',
  type: 'function',
  params: { a: { type: 'int', runtimeType: 'number' }, b: { type: 'int', runtimeType: 'number' } },
  returns: { runtimeType: 'number', columnType: 'int' },
  deterministic: true,
  body: 'return a + b',
});

const SumProc = new Routine({
  name: 'bun_ma_sum_proc',
  type: 'procedure',
  params: {
    a: { type: 'int', runtimeType: 'number' },
    b: { type: 'int', runtimeType: 'number' },
    out_total: { type: 'int', runtimeType: 'number', direction: 'out', ref: true },
  },
  body: 'set out_total = a + b',
});

describeMariadb('callRoutine (mariadb)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await MikroORM.init({
      driver: BunMariaDbDriver,
      clientUrl: MARIADB_URL,
      entities: [RtMaRow],
      routines: [AddFn, SumProc],
    } as unknown as Options);
    const c = orm.em.getConnection();
    await c.execute('drop function if exists bun_ma_add');
    await c.execute('drop procedure if exists bun_ma_sum_proc');
    await c.execute('create function bun_ma_add(a int, b int) returns int deterministic return a + b');
    await c.execute(
      'create procedure bun_ma_sum_proc(in a int, in b int, out out_total int) begin set out_total = a + b; end',
    );
  });
  afterAll(async () => {
    const c = orm.em.getConnection();
    await c.execute('drop function if exists bun_ma_add').catch(() => undefined);
    await c.execute('drop procedure if exists bun_ma_sum_proc').catch(() => undefined);
    await orm.close(true);
  });

  test('invokes a scalar function via select fn(...)', async () => {
    const result = await orm.em.callRoutine(AddFn, { a: 3, b: 4 });
    expect(Number(result)).toBe(7);
  });

  test('invokes a procedure and writes back the OUT param via @vars', async () => {
    const out = new ScalarReference<number>(null as unknown as number, false);
    await orm.em.callRoutine(SumProc, { a: 10, b: 5, out_total: out } as never);
    expect(Number(out.unwrap())).toBe(15);
  });
});
