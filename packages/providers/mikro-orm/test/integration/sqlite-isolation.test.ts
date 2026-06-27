import { test, expect, beforeAll, afterAll, beforeEach, describe } from 'bun:test';
import { MikroORM, IsolationLevel, type Options } from '@mikro-orm/core';
import { SqlSchemaGenerator } from '@mikro-orm/sql';

import { Entity, PrimaryKey, Property } from '../../src/entity';
import { BunSqliteDriver } from '../../src/driver';

// C2 (sqlite): the isolation contract spans every database. SQLite has no per-transaction
// isolation/access-mode knobs (it is serializable via file locking), so the controller opens a
// plain transaction and IGNORES the requested level — exactly as a sane SQLite driver does. The
// contract to lock here is graceful acceptance: every standard level is accepted (no throw) and the
// transaction's commit/rollback still works. (pg is covered by transaction.test.ts via
// `show transaction_isolation`; mysql by mysql-isolation.test.ts via a dirty read.)
@Entity()
class SqIsoRow {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string' })
  tag!: string;
}

describe('transaction isolation (sqlite)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await MikroORM.init({
      driver: BunSqliteDriver,
      dbName: ':memory:',
      entities: [SqIsoRow],
      extensions: [SqlSchemaGenerator],
    } as unknown as Options);
  });
  afterAll(async () => {
    await orm.close(true);
  });
  beforeEach(async () => {
    const sg = (orm as unknown as { schema: { drop(o?: { dropForeignKeys?: boolean }): Promise<void>; create(): Promise<void> } }).schema;
    await sg.drop({ dropForeignKeys: true });
    await sg.create();
  });

  const LEVELS: IsolationLevel[] = [
    IsolationLevel.READ_UNCOMMITTED,
    IsolationLevel.READ_COMMITTED,
    IsolationLevel.REPEATABLE_READ,
    IsolationLevel.SERIALIZABLE,
  ];

  for (const level of LEVELS) {
    test(`accepts isolation level "${level}" and commits the transaction`, async () => {
      await orm.em.fork().transactional(
        async (em) => {
          em.persist(em.create(SqIsoRow, { tag: level }));
        },
        { isolationLevel: level },
      );
      expect(await orm.em.fork().count(SqIsoRow, { tag: level })).toBe(1);
    });
  }

  test('a thrown transaction still rolls back under a requested isolation level', async () => {
    await expect(
      orm.em.fork().transactional(
        async (em) => {
          em.persist(em.create(SqIsoRow, { tag: 'rollback' }));
          throw new Error('boom');
        },
        { isolationLevel: IsolationLevel.SERIALIZABLE },
      ),
    ).rejects.toThrow('boom');
    expect(await orm.em.fork().count(SqIsoRow, {})).toBe(0);
  });
});
