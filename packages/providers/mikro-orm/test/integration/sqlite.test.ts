import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MikroORM, UniqueConstraintViolationException, type Options } from '@mikro-orm/core';
import { SqlSchemaGenerator } from '@mikro-orm/sql';

import { Entity, PrimaryKey, Property } from '../../src/entity';
import { BunSqliteDriver } from '../../src/driver';

// sqlite is in-process (no docker). Single synchronous connection, no reserve.

@Entity()
class Widget {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string', unique: true })
  sku!: string;
}

describe('BunSqliteDriver (in-memory)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await MikroORM.init({
      driver: BunSqliteDriver,
      dbName: ':memory:',
      entities: [Widget],
      extensions: [SqlSchemaGenerator],
    } as unknown as Options);
  });
  afterAll(async () => {
    await orm.close(true);
  });
  beforeEach(async () => {
    const s = orm as unknown as { schema: { drop(o?: { dropForeignKeys?: boolean }): Promise<void>; create(): Promise<void> } };
    await s.schema.drop({ dropForeignKeys: true });
    await s.schema.create();
  });

  test('acquires a connection and executes a query', async () => {
    const rows = (await orm.em.getConnection().execute('select 1 as one')) as Array<{ one: number }>;
    expect(rows).toEqual([{ one: 1 }]);
  });

  test('CRUD round-trips an entity', async () => {
    const em = orm.em.fork();
    const w = em.create(Widget, { sku: 'W-1' });
    em.persist(w);
    await em.flush();
    expect(w.id).toBeGreaterThan(0);

    const found = await orm.em.fork().findOneOrFail(Widget, { sku: 'W-1' });
    expect(found.id).toBe(w.id);
  });

  test('a duplicate unique insert raises UniqueConstraintViolationException', async () => {
    const em1 = orm.em.fork();
    em1.persist(em1.create(Widget, { sku: 'dup' }));
    await em1.flush();

    const em2 = orm.em.fork();
    em2.persist(em2.create(Widget, { sku: 'dup' }));
    await expect(em2.flush()).rejects.toBeInstanceOf(UniqueConstraintViolationException);
  });

  test('a nested transaction rollback (savepoint) discards only inner writes', async () => {
    await orm.em.fork().transactional(async (outer) => {
      outer.persist(outer.create(Widget, { sku: 'outer' }));
      await outer.flush();
      await outer
        .transactional(async (inner) => {
          inner.persist(inner.create(Widget, { sku: 'inner' }));
          await inner.flush();
          throw new Error('rollback-inner');
        })
        .catch(() => undefined);
    });
    const em = orm.em.fork();
    expect(await em.count(Widget, { sku: 'outer' })).toBe(1);
    expect(await em.count(Widget, { sku: 'inner' })).toBe(0);
  });
});
