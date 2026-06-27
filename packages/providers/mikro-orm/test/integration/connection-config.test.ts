import { test, expect, afterEach } from 'bun:test';
import { MikroORM, type Options } from '@mikro-orm/core';

import { Entity, PrimaryKey } from '../../src/entity';
import { BunPostgreSqlDriver } from '../../src/driver';
import { PG_URL, describePg } from './helpers';

// RED (gap A): the official drivers resolve the connection via getConnectionOptions(), which
// accepts EITHER a clientUrl OR discrete host/port/user/password/dbName. Ours read only
// `clientUrl`, so the standard host/port config form timed out. Also `pool.max` was ignored.
@Entity()
class CfgRow {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;
}

describePg('connection config (postgres)', () => {
  let orm: MikroORM | undefined;
  afterEach(async () => {
    await orm?.close(true);
    orm = undefined;
  });

  test('connects when configured with discrete host/port/user/password/dbName (no clientUrl)', async () => {
    const u = new URL(PG_URL!);
    orm = await MikroORM.init({
      driver: BunPostgreSqlDriver,
      host: u.hostname,
      port: Number(u.port),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      dbName: u.pathname.replace(/^\//, ''),
      entities: [CfgRow],
    } as unknown as Options);
    const rows = (await orm.em.getConnection().execute('select 1 as ok')) as Array<{ ok: number }>;
    expect(rows[0]?.ok).toBe(1);
  });

  test('merges driverOptions into the dialect (a custom createClient is used)', async () => {
    let called = 0;
    orm = await MikroORM.init({
      driver: BunPostgreSqlDriver,
      clientUrl: PG_URL,
      entities: [CfgRow],
      driverOptions: {
        createClient: (url: string, max: number) => {
          called += 1;
          return new (Bun as unknown as { SQL: new (u: string, o: { max: number }) => unknown }).SQL(url, { max });
        },
      },
    } as unknown as Options);
    await orm.em.getConnection().execute('select 1');
    expect(called).toBeGreaterThan(0);
  });

  test('honours the configured pool size (pool.max)', async () => {
    orm = await MikroORM.init({
      driver: BunPostgreSqlDriver,
      clientUrl: PG_URL,
      entities: [CfgRow],
      pool: { max: 3 },
    } as unknown as Options);
    // 5 concurrent reserve()-backed transactions on a max:3 pool must all complete (queue, not fail)
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        orm!.em.fork().transactional(async (em) => {
          await em.getConnection().execute('select pg_sleep(0.05)', [], 'all', em.getTransactionContext());
        }),
      ),
    );
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
  });
});
