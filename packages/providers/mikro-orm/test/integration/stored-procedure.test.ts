import { test, expect, beforeAll, afterAll } from 'bun:test';
import { MikroORM, type Options } from '@mikro-orm/core';

import { Entity, PrimaryKey } from '../../src/entity';
import { BunPostgreSqlDriver } from '../../src/driver';
import { PG_URL, describePg } from './helpers';

// Stored functions and procedures work over Bun.SQL via the connection's raw execute()
// — CALL <proc> and SELECT <func>(...) both run. (Only refcursor OUT parameters are out
// of reach, because they require cursor support Bun.SQL does not have.)
@Entity()
class SpDummy {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;
}

describePg('stored functions / procedures (postgres)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await MikroORM.init({ driver: BunPostgreSqlDriver, clientUrl: PG_URL, entities: [SpDummy] } as unknown as Options);
  });
  afterAll(async () => {
    const c = orm.em.getConnection();
    await c.execute('drop function if exists add_two(int, int)').catch(() => undefined);
    await c.execute('drop procedure if exists record_marker()').catch(() => undefined);
    await c.execute('drop table if exists sp_marker').catch(() => undefined);
    await orm.close(true);
  });

  test('a SQL function is callable via SELECT and returns its result', async () => {
    const c = orm.em.getConnection();
    await c.execute('create or replace function add_two(a int, b int) returns int language sql as $$ select a + b $$');
    const rows = (await c.execute('select add_two(3, 4) as sum')) as Array<{ sum: number }>;
    expect(rows[0]?.sum).toBe(7);
  });

  test('a stored procedure invoked via CALL actually runs its body (observable side effect)', async () => {
    const c = orm.em.getConnection();
    await c.execute('drop table if exists sp_marker');
    await c.execute('create table sp_marker (id serial primary key, note text not null)');
    await c.execute(
      `create or replace procedure record_marker() language plpgsql as $$ begin insert into sp_marker (note) values ('called'); end $$`,
    );
    await c.execute('call record_marker()');
    const rows = (await c.execute('select note from sp_marker')) as Array<{ note: string }>;
    expect(rows.map((r) => r.note)).toEqual(['called']);
  });
});
