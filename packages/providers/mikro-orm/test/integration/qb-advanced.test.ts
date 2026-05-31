import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { Collection, MikroORM, raw } from '@mikro-orm/core';
import type { SqlEntityManager } from '@mikro-orm/sql';

import { Entity, PrimaryKey, Property, OneToMany, ManyToOne } from '../../src/entity';
import { BunPostgreSqlDriver } from '../../src/driver';
import { PG_URL, describePg, makeOrm, freshSchema } from './helpers';

@Entity()
class Shop {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string' })
  name!: string;

  @OneToMany({ entity: () => Product, mappedBy: 'shop' })
  products = new Collection<Product>(this);
}

@Entity()
class Product {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string' })
  title!: string;

  @Property({ type: 'number' })
  price!: number;

  @ManyToOne({ entity: () => Shop })
  shop!: Shop;
}

describePg('QueryBuilder advanced: joins / subquery / raw (postgres)', () => {
  let orm: MikroORM;
  // em.createQueryBuilder lives on the SQL EntityManager (typed as the base EM by `.fork()`).
  const qbEm = (): SqlEntityManager => orm.em.fork() as unknown as SqlEntityManager;

  beforeAll(async () => {
    orm = await makeOrm(BunPostgreSqlDriver, PG_URL!, [Shop, Product]);
  });
  afterAll(async () => {
    await orm.close(true);
  });
  beforeEach(async () => {
    await freshSchema(orm);
    const em = orm.em.fork();
    const a = em.create(Shop, { name: 'A' });
    const b = em.create(Shop, { name: 'B' });
    em.create(Product, { title: 'cheap', price: 5, shop: a });
    em.create(Product, { title: 'mid', price: 50, shop: a });
    em.create(Product, { title: 'lux', price: 500, shop: b });
    await em.flush();
  });

  test('leftJoinAndSelect hydrates the joined collection in one query', async () => {
    const shops = await qbEm()
      .createQueryBuilder(Shop, 's')
      .select('*')
      .leftJoinAndSelect('s.products', 'p')
      .where({ name: 'A' })
      .getResultList();
    expect(shops).toHaveLength(1);
    expect(shops[0]?.products.length).toBe(2);
  });

  test('innerJoin with a WHERE on the joined table filters rows', async () => {
    const shops = await qbEm()
      .createQueryBuilder(Shop, 's')
      .select('s.*')
      .innerJoin('s.products', 'p')
      .where({ 'p.price': { $gte: 400 } })
      .getResultList();
    expect(shops.map((s) => s.name)).toEqual(['B']);
  });

  test('a raw fragment in SELECT executes (aggregate over the driver)', async () => {
    const rows = (await qbEm()
      .createQueryBuilder(Product, 'p')
      .select(raw('count(*) as cnt'))
      .execute('all')) as Array<{ cnt: number | string }>;
    expect(Number(rows[0]?.cnt)).toBe(3);
  });

  test('a nested relation filter compiles to a subquery and restricts the result', async () => {
    // `{ products: { price } }` makes MikroORM emit a correlated subquery/join over the driver.
    const shops = await orm.em.fork().find(Shop, { products: { price: { $gte: 400 } } });
    expect(shops.map((s) => s.name)).toEqual(['B']);
  });
});
