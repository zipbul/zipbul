import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MikroORM, type Options } from '@mikro-orm/core';

import { Entity, PrimaryKey, Property, Embeddable, Embedded, BeforeCreate } from '../../src/entity';
import { BunPostgreSqlDriver } from '../../src/driver';
import { PG_URL, describePg } from './helpers';

@Embeddable()
class Address {
  @Property({ type: 'string' })
  city!: string;

  @Property({ type: 'string' })
  zip!: string;
}

@Entity()
class Person {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string' })
  name!: string;

  @Embedded({ entity: () => Address })
  address!: Address;

  @Property({ type: 'string', nullable: true })
  slug?: string;

  @BeforeCreate()
  setSlug(): void {
    this.slug = this.name.toLowerCase();
  }
}

describePg('embeddables + lifecycle hooks (postgres)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await MikroORM.init({ driver: BunPostgreSqlDriver, clientUrl: PG_URL, entities: [Person, Address] } as unknown as Options);
  });
  afterAll(async () => {
    await orm.close(true);
  });
  beforeEach(async () => {
    const s = orm as unknown as { schema: { drop(o?: { dropForeignKeys?: boolean }): Promise<void>; create(): Promise<void> } };
    await s.schema.drop({ dropForeignKeys: true });
    await s.schema.create();
  });

  test('an embedded value object round-trips as flattened columns', async () => {
    const em = orm.em.fork();
    const p = em.create(Person, { name: 'Ada', address: { city: 'London', zip: 'E1' } });
    em.persist(p);
    await em.flush();

    const found = await orm.em.fork().findOneOrFail(Person, { id: p.id });
    expect(found.address.city).toBe('London');
    expect(found.address.zip).toBe('E1');
  });

  test('a @BeforeCreate hook runs before insert', async () => {
    const em = orm.em.fork();
    const p = em.create(Person, { name: 'Grace', address: { city: 'NY', zip: '10001' } });
    em.persist(p);
    await em.flush();
    expect(p.slug).toBe('grace');

    const found = await orm.em.fork().findOneOrFail(Person, { id: p.id });
    expect(found.slug).toBe('grace');
  });

  test('querying by an embedded property works', async () => {
    const em = orm.em.fork();
    em.persist(em.create(Person, { name: 'A', address: { city: 'Paris', zip: '75001' } }));
    await em.flush();
    const found = await orm.em.fork().find(Person, { address: { city: 'Paris' } });
    expect(found.map((p) => p.name)).toEqual(['A']);
  });
});
