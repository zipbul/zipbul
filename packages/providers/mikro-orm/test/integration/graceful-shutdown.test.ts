import { test, expect, beforeAll, afterAll } from 'bun:test';
import { MikroORM, type Options } from '@mikro-orm/core';

import { Entity, PrimaryKey } from '../../src/entity';
import { BunPostgreSqlDriver } from '../../src/driver';
import { PG_URL, describePg } from './helpers';

// orm.close(true) is a GRACEFUL shutdown: it waits for in-flight work to finish before
// tearing down the pool. MikroOrmService.onDestroy relies on this for clean shutdown.
@Entity()
class ShutdownDummy {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;
}

describePg('graceful shutdown drain (postgres)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await MikroORM.init({ driver: BunPostgreSqlDriver, clientUrl: PG_URL, entities: [ShutdownDummy] } as unknown as Options);
  });
  afterAll(async () => {
    await orm.close(true).catch(() => undefined);
  });

  test('close(true) drains an in-flight query instead of severing it', async () => {
    const inflight = orm.em.getConnection().execute('select pg_sleep(0.4), 42 as v') as Promise<Array<{ v: number }>>;
    // give the query time to actually be in flight before requesting shutdown
    await new Promise((resolve) => setTimeout(resolve, 50));

    await orm.close(true);

    const rows = await inflight;
    expect(rows[0]?.v).toBe(42);
  });
});
