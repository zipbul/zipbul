import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MikroORM } from '@mikro-orm/core';

import {
  Entity,
  PrimaryKey,
  Property,
  BeforeCreate,
  BeforeUpdate,
  AfterCreate,
  AfterUpdate,
  BeforeDelete,
  AfterDelete,
  OnLoad,
} from '../../src/entity';
import { BunPostgreSqlDriver } from '../../src/driver';
import { PG_URL, describePg, makeOrm, freshSchema } from './helpers';

// Exercises the full lifecycle-hook surface beyond @BeforeCreate (which embeddable-hooks
// already covers): update hooks, after-* hooks, delete hooks, and @OnLoad.
@Entity()
class Tracked {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string' })
  name!: string;

  @Property({ type: 'number' })
  revision: number = 0;

  // not persisted — populated by @OnLoad to prove it fires
  loaded?: boolean;

  @Property({ type: 'string', nullable: true })
  trail?: string;

  @BeforeCreate()
  onBeforeCreate(): void {
    this.trail = 'bc';
  }

  @AfterCreate()
  onAfterCreate(): void {
    this.trail = `${this.trail},ac`;
  }

  @BeforeUpdate()
  onBeforeUpdate(): void {
    this.revision += 1;
  }

  @AfterUpdate()
  onAfterUpdate(): void {
    this.trail = `${this.trail},au`;
  }

  @OnLoad()
  onLoadHook(): void {
    this.loaded = true;
  }
}

const deleteOrder: string[] = [];

@Entity()
class DeletableHooked {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string' })
  name!: string;

  @BeforeDelete()
  onBeforeDelete(): void {
    deleteOrder.push('before');
  }

  @AfterDelete()
  onAfterDelete(): void {
    deleteOrder.push('after');
  }
}

describePg('lifecycle hooks (postgres)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await makeOrm(BunPostgreSqlDriver, PG_URL!, [Tracked, DeletableHooked]);
  });
  afterAll(async () => {
    await orm.close(true);
  });
  beforeEach(async () => {
    await freshSchema(orm);
    deleteOrder.length = 0;
  });

  test('@BeforeUpdate fires and its mutation is persisted', async () => {
    const em = orm.em.fork();
    const t = em.create(Tracked, { name: 'n', revision: 0 });
    em.persist(t);
    await em.flush();

    const em2 = orm.em.fork();
    const loaded = await em2.findOneOrFail(Tracked, { name: 'n' });
    loaded.name = 'n2';
    await em2.flush();

    const fresh = await orm.em.fork().findOneOrFail(Tracked, { name: 'n2' });
    expect(fresh.revision).toBe(1); // bumped by @BeforeUpdate, written to the row
  });

  test('@OnLoad fires when an entity is hydrated from the database', async () => {
    const em = orm.em.fork();
    em.persist(em.create(Tracked, { name: 'load-me', revision: 0 }));
    await em.flush();

    const loaded = await orm.em.fork().findOneOrFail(Tracked, { name: 'load-me' });
    expect(loaded.loaded).toBe(true);
  });

  test('@BeforeDelete and @AfterDelete fire in order around removal', async () => {
    const em = orm.em.fork();
    em.persist(em.create(DeletableHooked, { name: 'gone' }));
    await em.flush();

    const em2 = orm.em.fork();
    const row = await em2.findOneOrFail(DeletableHooked, { name: 'gone' });
    em2.remove(row);
    await em2.flush();

    expect(deleteOrder).toEqual(['before', 'after']);
  });
});
