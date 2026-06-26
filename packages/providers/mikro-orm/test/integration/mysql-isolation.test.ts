import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MikroORM, IsolationLevel, type Options } from '@mikro-orm/core';
import { SqlSchemaGenerator } from '@mikro-orm/sql';

import { Entity, PrimaryKey, Property } from '../../src/entity';
import { BunMySqlDriver } from '../../src/driver';
import { MYSQL_URL, describeMysql } from './helpers';

// C2 regression: MySQL applies a per-transaction isolation level via `SET TRANSACTION ISOLATION
// LEVEL x` issued before `START TRANSACTION` on the same connection. A conformance candidate
// claimed this was silently ignored — it was a false positive from probing `@@transaction_isolation`
// (a SESSION variable that does not reflect the next-transaction SET). The real, behavioral proof
// is a dirty read: under READ UNCOMMITTED a transaction sees another connection's UNCOMMITTED row;
// under REPEATABLE READ (MySQL default) it does not. There was no MySQL isolation test before
// (only pg), so this locks the contract through the full MikroORM path.
@Entity()
class IsoRow {
  @PrimaryKey({ type: 'number' })
  id!: number;

  @Property({ type: 'string' })
  tag!: string;
}

describeMysql('transaction isolation (mysql)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await MikroORM.init({
      driver: BunMySqlDriver,
      clientUrl: MYSQL_URL,
      entities: [IsoRow],
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

  /** Holds an UNCOMMITTED insert on a separate physical connection while `fn` runs, then rolls back. */
  async function withUncommittedRow(fn: () => Promise<void>): Promise<void> {
    const holder = new Bun.SQL(MYSQL_URL!, { max: 1 });
    const table = orm.em.getMetadata().get(IsoRow).tableName;
    try {
      await holder.unsafe('begin');
      await holder.unsafe(`insert into \`${table}\` (id, tag) values (999, 'dirty')`);
      await fn();
    } finally {
      await holder.unsafe('rollback').catch(() => undefined);
      await holder.end();
    }
  }

  test('READ UNCOMMITTED sees another connection’s uncommitted row (dirty read)', async () => {
    let seen = -1;
    await withUncommittedRow(async () => {
      await orm.em.fork().transactional(
        async (em) => {
          seen = await em.count(IsoRow, { id: 999 });
        },
        { isolationLevel: IsolationLevel.READ_UNCOMMITTED },
      );
    });
    expect(seen).toBe(1);
  });

  test('REPEATABLE READ does NOT see the uncommitted row', async () => {
    let seen = -1;
    await withUncommittedRow(async () => {
      await orm.em.fork().transactional(
        async (em) => {
          seen = await em.count(IsoRow, { id: 999 });
        },
        { isolationLevel: IsolationLevel.REPEATABLE_READ },
      );
    });
    expect(seen).toBe(0);
  });
});
