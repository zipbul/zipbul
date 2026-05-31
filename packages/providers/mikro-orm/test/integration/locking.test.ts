import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MikroORM, LockMode, type Options } from '@mikro-orm/core';

import { Entity, PrimaryKey, Property } from '../../src/entity';
import { BunPostgreSqlDriver } from '../../src/driver';
import { PG_URL, describePg } from './helpers';

@Entity()
class Counter {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'number' })
  value!: number;

  @Property({ type: 'number', version: true })
  version!: number;
}

describePg('locking (postgres)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await MikroORM.init({ driver: BunPostgreSqlDriver, clientUrl: PG_URL, entities: [Counter] } as unknown as Options);
  });
  afterAll(async () => {
    await orm.close(true);
  });
  beforeEach(async () => {
    const s = orm as unknown as { schema: { drop(o?: { dropForeignKeys?: boolean }): Promise<void>; create(): Promise<void> } };
    await s.schema.drop({ dropForeignKeys: true });
    await s.schema.create();
    const em = orm.em.fork();
    em.persist(em.create(Counter, { value: 1 } as Counter));
    await em.flush();
  });

  test('pessimistic write lock issues SELECT ... FOR UPDATE without error', async () => {
    await orm.em.fork().transactional(async (em) => {
      const row = await em.findOneOrFail(Counter, { value: 1 }, { lockMode: LockMode.PESSIMISTIC_WRITE });
      expect(row.value).toBe(1);
    });
  });

  // RED (cascade of the affected-count bug): optimistic locking detects a version conflict
  // by the UPDATE's affected-row count. The driver currently reads .affectedRows (null) ->
  // numAffectedRows undefined -> MikroORM treats EVERY versioned update as a conflict, so
  // even a single non-concurrent update throws OptimisticLockError.
  test('a single update to a versioned entity succeeds and bumps the version', async () => {
    const em = orm.em.fork();
    const row = await em.findOneOrFail(Counter, { value: 1 });
    row.value = 2;
    await em.flush();
    const reread = await orm.em.fork().findOneOrFail(Counter, { id: row.id });
    expect(reread.value).toBe(2);
    expect(reread.version).toBe(2);
  });

  // The real optimistic-locking contract: a stale writer (loaded at version N, but the row
  // moved to N+1 by another fork) must fail on flush. This is what depends on the UPDATE's
  // affected-row count to detect the version mismatch.
  test('a concurrent stale update throws on the second writer', async () => {
    const a = orm.em.fork();
    const b = orm.em.fork();
    const rowA = await a.findOneOrFail(Counter, { value: 1 });
    const rowB = await b.findOneOrFail(Counter, { value: 1 }); // both observe version 1
    rowA.value = 10;
    await a.flush(); // version -> 2
    rowB.value = 20; // still thinks version is 1 -> stale
    await expect(b.flush()).rejects.toThrow();
  });
});
