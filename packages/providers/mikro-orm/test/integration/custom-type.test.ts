import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MikroORM, Type } from '@mikro-orm/core';

import { Entity, PrimaryKey, Property } from '../../src/entity';
import { BunPostgreSqlDriver } from '../../src/driver';
import { PG_URL, describePg, makeOrm, freshSchema } from './helpers';

// A custom MikroORM Type: converts the value on the way to/from the database. Proves the
// driver honours MikroORM's own value conversion layer (which runs before/after SQL).
class UpperCaseType extends Type<string, string> {
  override convertToDatabaseValue(value: string): string {
    return value.toUpperCase();
  }
  override convertToJSValue(value: string): string {
    return value;
  }
  override getColumnType(): string {
    return 'varchar(64)';
  }
}

@Entity()
class TaggedRow {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: UpperCaseType })
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

  test('the custom type converts the value on the way into the database', async () => {
    const em = orm.em.fork();
    em.persist(em.create(TaggedRow, { code: 'abc' }));
    await em.flush();

    // raw read proves the stored value went through convertToDatabaseValue (uppercased)
    const rows = (await orm.em.getConnection().execute('select code from tagged_row')) as Array<{ code: string }>;
    expect(rows[0]?.code).toBe('ABC');

    // querying by the lowercase value also goes through convertToDatabaseValue → matches
    const found = await orm.em.fork().findOneOrFail(TaggedRow, { code: 'abc' });
    expect(found.code).toBe('ABC');
  });
});
