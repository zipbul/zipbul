import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { IsolationLevel, type MikroORM } from '@mikro-orm/core';

import { BunPostgreSqlDriver } from '../../src/driver';
import {PG_URL, describePg, makeOrm, freshSchema} from './helpers';
import { Entity, PrimaryKey, Property } from '../../src/entity';

@Entity()
class TxAccount {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string', unique: true })
  email!: string;

  @Property({ type: 'string' })
  name!: string;
}

describePg('transactions (postgres)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await makeOrm(BunPostgreSqlDriver, PG_URL!, [TxAccount]);
  });
  afterAll(async () => {
    await orm.close(true);
  });
  beforeEach(async () => {
    await freshSchema(orm);
  });

  test('a committed transaction persists its writes', async () => {
    await orm.em.fork().transactional(async (em) => {
      em.persist(em.create(TxAccount, { email: 't1@x.io', name: 'Committed' }));
    });
    const count = await orm.em.fork().count(TxAccount, { email: 't1@x.io' });
    expect(count).toBe(1);
  });

  test('a thrown transaction rolls back its writes', async () => {
    await expect(
      orm.em.fork().transactional(async (em) => {
        em.persist(em.create(TxAccount, { email: 't2@x.io', name: 'RolledBack' }));
        await em.flush();
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const count = await orm.em.fork().count(TxAccount, { email: 't2@x.io' });
    expect(count).toBe(0);
  });

  test('a nested transaction rollback (savepoint) discards only the inner writes', async () => {
    await orm.em.fork().transactional(async (outer) => {
      outer.persist(outer.create(TxAccount, { email: 'outer@x.io', name: 'Outer' }));
      await outer.flush();
      await outer
        .transactional(async (inner) => {
          inner.persist(inner.create(TxAccount, { email: 'inner@x.io', name: 'Inner' }));
          await inner.flush();
          throw new Error('inner-rollback');
        })
        .catch(() => undefined);
    });
    const em = orm.em.fork();
    expect(await em.count(TxAccount, { email: 'outer@x.io' })).toBe(1);
    expect(await em.count(TxAccount, { email: 'inner@x.io' })).toBe(0);
  });

  test('~20 concurrent transactions all commit with distinct rows (reserve pool)', async () => {
    const N = 20;
    const results = await Promise.allSettled(
      Array.from({ length: N }, (_, i) =>
        orm.em.fork().transactional(async (em) => {
          em.persist(em.create(TxAccount, { email: `c${i}@x.io`, name: `User${i}` }));
        }),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(N);
    expect(await orm.em.fork().count(TxAccount, {})).toBe(N);
  });

  // Regression guard: a requested isolation level must ACTUALLY take effect. The original
  // driver issued `SET TRANSACTION ISOLATION LEVEL x` BEFORE `BEGIN`, which postgres silently
  // ignores — every transaction ran at the session default (read committed) regardless of the
  // requested level. The fix composes the level into BEGIN; this proves it reaches the engine.
  // The observation query must run ON the transaction's own connection, so the active
  // transaction context is threaded into execute() — otherwise it borrows a fresh pooled
  // connection and reports the session default, masking the in-transaction setting.
  const showInTxn = async (
    setting: 'transaction_isolation' | 'transaction_read_only',
    options: Parameters<ReturnType<MikroORM['em']['fork']>['transactional']>[1],
  ): Promise<string> => {
    let observed = '';
    await orm.em.fork().transactional(async (em) => {
      const ctx = (em as unknown as { getTransactionContext(): unknown }).getTransactionContext();
      const rows = (await em.getConnection().execute(`show ${setting}`, [], 'all', ctx)) as Array<
        Record<string, string>
      >;
      observed = rows[0]?.[setting] ?? '';
    }, options);
    return observed;
  };

  test('a SERIALIZABLE transaction actually runs at serializable', async () => {
    expect(await showInTxn('transaction_isolation', { isolationLevel: IsolationLevel.SERIALIZABLE })).toBe(
      'serializable',
    );
  });

  test('a REPEATABLE READ transaction actually runs at repeatable read', async () => {
    expect(await showInTxn('transaction_isolation', { isolationLevel: IsolationLevel.REPEATABLE_READ })).toBe(
      'repeatable read',
    );
  });

  test('a read-only transaction actually marks the connection read-only', async () => {
    expect(await showInTxn('transaction_read_only', { readOnly: true })).toBe('on');
  });

  // B5 invariant (why the driver reserves): issuing a raw `begin` on a NON-reserved pooled
  // Bun.SQL connection is rejected by Bun.SQL with ERR_POSTGRES_UNSAFE_TRANSACTION ("Only use
  // sql.begin, sql.reserved or max: 1"). That is exactly why BunSqlKyselyDriver.acquireConnection
  // calls reserve() for pooled drivers before BEGIN. The positive side of this contract — that
  // BEGIN *succeeds* on a reserved connection — is proven by the four tests above (commit,
  // rollback, nested savepoint, and 20 concurrent transactions all drive the reserve() path).
  //
  // The negative assertion (raw begin REJECTS) is verified standalone via `bun run` but is NOT
  // expressible here: under the `bun test` runtime a rejected unsafe-transaction promise on a
  // pooled connection never settles (it hangs until the per-test timeout, and as the first query
  // on a fresh pool it can wedge the whole runner). It asserts a Bun.SQL runtime invariant, not
  // this driver's behavior, so it is documented here rather than executed.
});
