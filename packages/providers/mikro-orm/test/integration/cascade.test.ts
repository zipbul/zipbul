import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { Collection, MikroORM, Cascade } from '@mikro-orm/core';

import { Entity, PrimaryKey, Property, OneToMany, ManyToOne } from '../../src/entity';
import { BunPostgreSqlDriver } from '../../src/driver';
import { PG_URL, describePg, makeOrm, freshSchema } from './helpers';

@Entity()
class CascParent {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string' })
  name!: string;

  @OneToMany({ entity: () => CascChild, mappedBy: 'parent', cascade: [Cascade.ALL], orphanRemoval: true })
  children = new Collection<CascChild>(this);
}

@Entity()
class CascChild {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string' })
  label!: string;

  @ManyToOne({ entity: () => CascParent })
  parent!: CascParent;
}

describePg('cascade + orphan removal (postgres)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await makeOrm(BunPostgreSqlDriver, PG_URL!, [CascParent, CascChild]);
  });
  afterAll(async () => {
    await orm.close(true);
  });
  beforeEach(async () => {
    await freshSchema(orm);
  });

  test('cascade persist saves children when the parent is flushed', async () => {
    const em = orm.em.fork();
    const p = em.create(CascParent, { name: 'p' });
    p.children.add(em.create(CascChild, { label: 'a' } as never));
    p.children.add(em.create(CascChild, { label: 'b' } as never));
    em.persist(p);
    await em.flush();

    const count = await orm.em.fork().count(CascChild, {});
    expect(count).toBe(2);
  });

  test('orphan removal deletes a child removed from the collection', async () => {
    const em = orm.em.fork();
    const p = em.create(CascParent, { name: 'p2' });
    p.children.add(em.create(CascChild, { label: 'x' } as never));
    p.children.add(em.create(CascChild, { label: 'y' } as never));
    em.persist(p);
    await em.flush();

    const em2 = orm.em.fork();
    const loaded = await em2.findOneOrFail(CascParent, { name: 'p2' }, { populate: ['children'] });
    loaded.children.remove(loaded.children[0]!);
    await em2.flush();

    expect(await orm.em.fork().count(CascChild, {})).toBe(1);
  });

  test('cascade remove deletes children when the parent is removed', async () => {
    const em = orm.em.fork();
    const p = em.create(CascParent, { name: 'p3' });
    p.children.add(em.create(CascChild, { label: 'z' } as never));
    em.persist(p);
    await em.flush();

    const em2 = orm.em.fork();
    const loaded = await em2.findOneOrFail(CascParent, { name: 'p3' }, { populate: ['children'] });
    em2.remove(loaded);
    await em2.flush();

    expect(await orm.em.fork().count(CascChild, {})).toBe(0);
    expect(await orm.em.fork().count(CascParent, { name: 'p3' })).toBe(0);
  });
});
