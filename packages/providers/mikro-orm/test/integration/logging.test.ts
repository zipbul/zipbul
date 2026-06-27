import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MikroORM, type Options } from '@mikro-orm/core';

import { Entity, PrimaryKey, Property } from '../../src/entity';
import { BunPostgreSqlDriver } from '../../src/driver';
import { PG_URL, describePg } from './helpers';

@Entity()
class Logged {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string' })
  name!: string;
}

describePg('query logging (postgres)', () => {
  let orm: MikroORM;
  const logs: string[] = [];
  beforeAll(async () => {
    orm = await MikroORM.init({
      driver: BunPostgreSqlDriver,
      clientUrl: PG_URL,
      entities: [Logged],
      debug: true,
      logger: (message: string) => logs.push(message),
    } as unknown as Options);
  });
  afterAll(async () => {
    await orm.close(true);
  });
  beforeEach(async () => {
    const s = orm as unknown as { schema: { drop(o?: { dropForeignKeys?: boolean }): Promise<void>; create(): Promise<void> } };
    await s.schema.drop({ dropForeignKeys: true });
    await s.schema.create();
    logs.length = 0;
  });

  test('INSERT and SELECT statements reach the MikroORM logger', async () => {
    const em = orm.em.fork();
    em.persist(em.create(Logged, { name: 'x' }));
    await em.flush();
    await orm.em.fork().find(Logged, {});

    const all = logs.join('\n').toLowerCase();
    expect(all).toContain('insert into');
    expect(all).toContain('select');
  });

  test('transaction control statements (begin/commit) reach the logger', async () => {
    await orm.em.fork().transactional(async (em) => {
      em.persist(em.create(Logged, { name: 'tx' }));
    });
    const all = logs.join('\n').toLowerCase();
    expect(all).toContain('begin');
    expect(all).toContain('commit');
  });
});
