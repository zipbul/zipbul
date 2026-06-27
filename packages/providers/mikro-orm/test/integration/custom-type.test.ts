import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MikroORM, Type } from '@mikro-orm/core';

import { Entity, PrimaryKey, Property } from '../../src/entity';
import { BunPostgreSqlDriver } from '../../src/driver';
import { PG_URL, describePg, makeOrm, freshSchema } from './helpers';

// A custom MikroORM Type that converts in BOTH directions so each is independently provable:
// uppercased on the way to the DB, lowercased on the way back. Proves the driver honours
// MikroORM's value-conversion layer (which runs before/after SQL) in both directions.
class CaseFoldType extends Type<string, string> {
  override convertToDatabaseValue(value: string): string {
    return value.toUpperCase();
  }
  override convertToJSValue(value: string): string {
    return value.toLowerCase();
  }
  override getColumnType(): string {
    return 'varchar(64)';
  }
}

@Entity()
class TaggedRow {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: CaseFoldType })
  code!: string;
}

describePg('custom MikroORM Type (postgres)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await makeOrm(BunPostgreSqlDriver, PG_URL!, [TaggedRow]);
  });
  afterAll(async () => {
    await orm.close(true);
  });
  beforeEach(async () => {
    await freshSchema(orm);
  });

  test('the custom type converts the value in BOTH directions through the driver', async () => {
    const em = orm.em.fork();
    em.persist(em.create(TaggedRow, { code: 'abc' }));
    await em.flush();

    // raw read proves the WRITE direction (convertToDatabaseValue uppercased it)
    const rows = (await orm.em.getConnection().execute('select code from tagged_row')) as Array<{ code: string }>;
    expect(rows[0]?.code).toBe('ABC');

    // querying by the lowercase value goes through convertToDatabaseValue → matches the stored 'ABC';
    // the hydrated value proves the READ direction (convertToJSValue lowercased it back).
    const found = await orm.em.fork().findOneOrFail(TaggedRow, { code: 'abc' });
    expect(found.code).toBe('abc');
  });
});
