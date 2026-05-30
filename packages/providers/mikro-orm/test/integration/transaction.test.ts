import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { MikroORM } from '@mikro-orm/core';

import { BunPostgreSqlDriver } from '../../src/driver';
import { Account, PG_URL, describePg, makeOrm, freshSchema } from './helpers';

describePg('transactions (postgres)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await makeOrm(BunPostgreSqlDriver, PG_URL!);
  });
  afterAll(async () => {
    await orm.close(true);
  });
  beforeEach(async () => {
    await freshSchema(orm);
  });

  test('a committed transaction persists its writes', async () => {
    await orm.em.fork().transactional(async (em) => {
      em.persist(em.create(Account, { email: 't1@x.io', name: 'Committed' }));
    });
    const count = await orm.em.fork().count(Account, { email: 't1@x.io' });
    expect(count).toBe(1);
  });

  test('a thrown transaction rolls back its writes', async () => {
    await expect(
      orm.em.fork().transactional(async (em) => {
        em.persist(em.create(Account, { email: 't2@x.io', name: 'RolledBack' }));
        await em.flush();
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const count = await orm.em.fork().count(Account, { email: 't2@x.io' });
    expect(count).toBe(0);
  });

  test('a nested transaction rollback (savepoint) discards only the inner writes', async () => {
    await orm.em.fork().transactional(async (outer) => {
      outer.persist(outer.create(Account, { email: 'outer@x.io', name: 'Outer' }));
      await outer.flush();
      await outer
        .transactional(async (inner) => {
          inner.persist(inner.create(Account, { email: 'inner@x.io', name: 'Inner' }));
          await inner.flush();
          throw new Error('inner-rollback');
        })
        .catch(() => undefined);
    });
    const em = orm.em.fork();
    expect(await em.count(Account, { email: 'outer@x.io' })).toBe(1);
    expect(await em.count(Account, { email: 'inner@x.io' })).toBe(0);
  });

  test('~20 concurrent transactions all commit with distinct rows (reserve pool)', async () => {
    const N = 20;
    const results = await Promise.allSettled(
      Array.from({ length: N }, (_, i) =>
        orm.em.fork().transactional(async (em) => {
          em.persist(em.create(Account, { email: `c${i}@x.io`, name: `User${i}` }));
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(N);
    expect(await orm.em.fork().count(Account, {})).toBe(N);
  });

  // B5 regression: the design depends on reserve() to allow raw begin on a pooled conn.
  // Issuing begin on a NON-reserved pooled Bun.SQL connection must fail — proving why the
  // driver reserves. (Bun.SQL postgres throws ERR_POSTGRES_UNSAFE_TRANSACTION.)
  test('raw begin on a non-reserved pooled connection is rejected by Bun.SQL', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sql = new (Bun as any).SQL(PG_URL!, { max: 5 });
    try {
      await expect(sql.unsafe('begin')).rejects.toThrow();
    } finally {
      await sql.close();
    }
  });
});
