import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MikroORM, IsolationLevel, type Options } from '@mikro-orm/core';
import { SqlSchemaGenerator } from '@mikro-orm/sql';

import { Entity, PrimaryKey, Property } from '../../src/entity';
import { BunMariaDbDriver } from '../../src/driver';
import { MARIADB_URL, describeMariadb } from './helpers';

// Behavioral proof that per-transaction isolation level is applied through the MariaDB path
// (SET TRANSACTION ISOLATION LEVEL x before START TRANSACTION, on one connection): a dirty read
// is visible under READ UNCOMMITTED and hidden under REPEATABLE READ (MariaDB's default).
@Entity()
class IsoMaRow {
  @PrimaryKey({ type: 'number' })
  id!: number;

  @Property({ type: 'string' })
  tag!: string;
}

describeMariadb('transaction isolation (mariadb)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await MikroORM.init({
      driver: BunMariaDbDriver,
      clientUrl: MARIADB_URL,
      entities: [IsoMaRow],
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
    const holder = new Bun.SQL(MARIADB_URL!, { max: 1 });
    const table = orm.em.getMetadata().get(IsoMaRow).tableName;
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
          seen = await em.count(IsoMaRow, { id: 999 });
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
          seen = await em.count(IsoMaRow, { id: 999 });
        },
        { isolationLevel: IsolationLevel.REPEATABLE_READ },
      );
    });
    expect(seen).toBe(0);
  });
});
