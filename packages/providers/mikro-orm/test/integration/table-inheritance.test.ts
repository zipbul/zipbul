import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MikroORM } from '@mikro-orm/core';

import { Entity, PrimaryKey, Property } from '../../src/entity';
import { BunPostgreSqlDriver } from '../../src/driver';
import { PG_URL, describePg, makeOrm, freshSchema } from './helpers';

// Class-table inheritance (each subclass gets its own table, joined to the base) — the
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

describePg('class-table inheritance (postgres)', () => {
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

  test('each subclass lives in its own table joined to the base', async () => {
    const rows = (await orm.em
      .getConnection()
      .execute("select table_name from information_schema.tables where table_name in ('vehicle','car','boat') order by table_name")) as Array<{ table_name: string }>;
    expect(rows.map((r) => r.table_name)).toEqual(['boat', 'car', 'vehicle']);
  });

  test('a subclass row round-trips its own + inherited columns across the join', async () => {
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
