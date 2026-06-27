import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MikroORM } from '@mikro-orm/core';

import { Entity, PrimaryKey, Property } from '../../src/entity';
import { BunPostgreSqlDriver } from '../../src/driver';
import { PG_URL, describePg, makeOrm, freshSchema } from './helpers';

// Table-per-concrete-class inheritance: extending an abstract @Entity base (no discriminator)
// gives each CONCRETE subclass its own standalone table that COPIES the inherited columns — there
// is NO base/subclass join (MikroORM v7 has no joined/class-table strategy). Verified empirically:
// the `car` table carries its own `name` column. The inheritance flavour beyond single-table that
// inheritance flavour beyond single-table that `inheritance-filters` already covers.
@Entity()
abstract class Vehicle {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string' })
  name!: string;
}

@Entity()
class Car extends Vehicle {
  @Property({ type: 'number' })
  doors!: number;
}

@Entity()
class Boat extends Vehicle {
  @Property({ type: 'number' })
  lengthM!: number;
}

describePg('table-per-concrete-class inheritance (postgres)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await makeOrm(BunPostgreSqlDriver, PG_URL!, [Vehicle, Car, Boat]);
  });
  afterAll(async () => {
    await orm.close(true);
  });
  beforeEach(async () => {
    await freshSchema(orm);
  });

  test('each concrete subclass gets its own standalone table that copies inherited columns (no join)', async () => {
    const conn = orm.em.getConnection();
    const rows = (await conn.execute(
      "select table_name from information_schema.tables where table_name in ('vehicle','car','boat') order by table_name",
    )) as Array<{ table_name: string }>;
    expect(rows.map((r) => r.table_name)).toEqual(['boat', 'car', 'vehicle']);

    // the inherited `name` column lives ON the `car` table itself (copied), proving there is no
    // FK/join back to `vehicle` — this is table-per-concrete-class, not joined class-table inheritance.
    const carCols = (await conn.execute(
      "select column_name from information_schema.columns where table_name = 'car' order by column_name",
    )) as Array<{ column_name: string }>;
    expect(carCols.map((c) => c.column_name)).toEqual(['doors', 'id', 'name']);
  });

  test('a subclass row round-trips its own + inherited columns from its standalone table', async () => {
    const em = orm.em.fork();
    em.persist(em.create(Car, { name: 'tesla', doors: 4 }));
    em.persist(em.create(Boat, { name: 'skiff', lengthM: 5 }));
    await em.flush();

    const car = await orm.em.fork().findOneOrFail(Car, { name: 'tesla' });
    expect(car.doors).toBe(4);
    expect(car.name).toBe('tesla');

    const boat = await orm.em.fork().findOneOrFail(Boat, { name: 'skiff' });
    expect(boat.lengthM).toBe(5);
  });
});
