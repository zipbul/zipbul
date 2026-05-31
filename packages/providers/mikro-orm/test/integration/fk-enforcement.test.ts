import { test, expect, beforeAll, afterAll, beforeEach, describe } from 'bun:test';
import { Collection, ForeignKeyConstraintViolationException, MikroORM, type Options } from '@mikro-orm/core';
import { SqlSchemaGenerator } from '@mikro-orm/sql';

import { Entity, PrimaryKey, Property, ManyToOne, OneToMany } from '../../src/entity';
import { BunSqliteDriver } from '../../src/driver';

// RED (gap I): SQLite disables foreign keys by default — the official BaseSqliteConnection
// runs `pragma foreign_keys = on` on connect. Our SqliteConnection extended AbstractSqlConnection
// directly and skipped it, so FK constraints were silently NOT enforced. These prove enforcement.
@Entity()
class FkParent {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string' })
  name!: string;

  @OneToMany({ entity: () => FkChild, mappedBy: 'parent' })
  children = new Collection<FkChild>(this);
}

@Entity()
class FkChild {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @ManyToOne({ entity: () => FkParent })
  parent!: FkParent;
}

describe('foreign key enforcement (sqlite)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await MikroORM.init({
      driver: BunSqliteDriver,
      dbName: ':memory:',
      entities: [FkParent, FkChild],
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

  test('PRAGMA foreign_keys is ON', async () => {
    const rows = (await orm.em.getConnection().execute('pragma foreign_keys')) as Array<{ foreign_keys: number }>;
    expect(rows[0]?.foreign_keys).toBe(1);
  });

  test('inserting a child that references a non-existent parent is rejected', async () => {
    const c = orm.em.getConnection();
    await expect(c.execute('insert into fk_child (id, parent_id) values (1, 999)')).rejects.toBeDefined();
  });

  test('a FK violation surfaces as ForeignKeyConstraintViolationException through the ORM', async () => {
    const em = orm.em.fork();
    const p = em.create(FkParent, { name: 'p' });
    p.children.add(em.create(FkChild, {} as never));
    em.persist(p);
    await em.flush();

    // nativeDelete is raw (no cascade) — deleting the parent with a child violates the FK,
    // and the driver's exception path converts it to the typed ORM exception.
    await expect(orm.em.fork().nativeDelete(FkParent, { id: p.id })).rejects.toBeInstanceOf(
      ForeignKeyConstraintViolationException,
    );
  });
});
