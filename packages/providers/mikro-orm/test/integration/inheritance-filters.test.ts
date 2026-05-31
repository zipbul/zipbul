import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MikroORM, type Options } from '@mikro-orm/core';

import { Entity, PrimaryKey, Property, Enum, Filter } from '../../src/entity';
import { BunPostgreSqlDriver } from '../../src/driver';
import { PG_URL, describePg } from './helpers';

// --- Single-table inheritance ---
@Entity({ discriminatorColumn: 'kind', abstract: true })
abstract class Animal {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Enum({ items: ['cat', 'dog'] })
  kind!: 'cat' | 'dog';

  @Property({ type: 'string' })
  name!: string;
}

@Entity({ discriminatorValue: 'cat' })
class Cat extends Animal {
  @Property({ type: 'boolean', nullable: true })
  indoor?: boolean;
}

@Entity({ discriminatorValue: 'dog' })
class Dog extends Animal {
  @Property({ type: 'number', nullable: true })
  legs?: number;
}

// --- Filter / soft delete ---
@Filter({ name: 'notDeleted', cond: { deletedAt: null }, default: true })
@Entity()
class Doc {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string' })
  title!: string;

  @Property({ type: 'Date', nullable: true })
  deletedAt?: Date | null;
}

describePg('inheritance + filters (postgres)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await MikroORM.init({ driver: BunPostgreSqlDriver, clientUrl: PG_URL, entities: [Animal, Cat, Dog, Doc] } as unknown as Options);
  });
  afterAll(async () => {
    await orm.close(true);
  });
  beforeEach(async () => {
    const s = orm as unknown as { schema: { drop(o?: { dropForeignKeys?: boolean }): Promise<void>; create(): Promise<void> } };
    await s.schema.drop({ dropForeignKeys: true });
    await s.schema.create();
  });

  test('STI — subclasses persist and load as their concrete type via the discriminator', async () => {
    const em = orm.em.fork();
    em.persist(em.create(Cat, { kind: 'cat', name: 'Tom', indoor: true }));
    em.persist(em.create(Dog, { kind: 'dog', name: 'Rex', legs: 4 }));
    await em.flush();

    const animals = await orm.em.fork().find(Animal, {});
    expect(animals.map((a) => a.constructor.name).sort()).toEqual(['Cat', 'Dog']);
    const cat = await orm.em.fork().findOneOrFail(Cat, { name: 'Tom' });
    expect(cat.indoor).toBe(true);
  });

  test('STI — querying the base type returns all subclasses', async () => {
    const em = orm.em.fork();
    em.persist(em.create(Cat, { kind: 'cat', name: 'A' }));
    em.persist(em.create(Dog, { kind: 'dog', name: 'B' }));
    await em.flush();
    expect(await orm.em.fork().count(Animal, {})).toBe(2);
  });

  test('soft-delete filter excludes deleted rows by default and includes them when disabled', async () => {
    const em = orm.em.fork();
    const live = em.create(Doc, { title: 'live' });
    const dead = em.create(Doc, { title: 'dead', deletedAt: new Date() });
    em.persist([live, dead]);
    await em.flush();

    const visible = await orm.em.fork().find(Doc, {});
    expect(visible.map((d) => d.title)).toEqual(['live']);

    const all = await orm.em.fork().find(Doc, {}, { filters: { notDeleted: false } });
    expect(all.length).toBe(2);
  });
});
