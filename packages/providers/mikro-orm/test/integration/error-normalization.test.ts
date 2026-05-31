import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { UniqueConstraintViolationException, type MikroORM } from '@mikro-orm/core';

import { BunPostgreSqlDriver, BunMySqlDriver } from '../../src/driver';
import {PG_URL, MYSQL_URL, describePg, describeMysql, makeOrm, freshSchema} from './helpers';
import { Entity, PrimaryKey, Property } from '../../src/entity';

// The design's BLOCKING fix: the per-DB error normalizer must rewrite the raw Bun.SQL
// error so MikroORM's official ExceptionConverter turns a unique violation into a real
// UniqueConstraintViolationException. (pg copies errno->code; mysql must align errno 1062.)

@Entity()
class EnAccount {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string', unique: true })
  email!: string;

  @Property({ type: 'string' })
  name!: string;
}

describePg('error normalization (postgres)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await makeOrm(BunPostgreSqlDriver, PG_URL!, [EnAccount]);
  });
  afterAll(async () => {
    await orm.close(true);
  });
  beforeEach(async () => {
    await freshSchema(orm);
  });

  test('a duplicate insert raises UniqueConstraintViolationException', async () => {
    const em1 = orm.em.fork();
    em1.persist(em1.create(EnAccount, { email: 'dup@x.io', name: 'First' }));
    await em1.flush();

    const em2 = orm.em.fork();
    em2.persist(em2.create(EnAccount, { email: 'dup@x.io', name: 'Second' }));
    await expect(em2.flush()).rejects.toBeInstanceOf(UniqueConstraintViolationException);
  });
});

describeMysql('error normalization (mysql)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await makeOrm(BunMySqlDriver, MYSQL_URL!, [EnAccount]);
  });
  afterAll(async () => {
    await orm.close(true);
  });
  beforeEach(async () => {
    await freshSchema(orm);
  });

  // RED candidate: mysql normalizer is currently an identity stub. If Bun.SQL surfaces
  // errno 1062 natively this is GREEN; otherwise it drives the mysql normalizer.
  test('a duplicate insert raises UniqueConstraintViolationException', async () => {
    const em1 = orm.em.fork();
    em1.persist(em1.create(EnAccount, { email: 'dup@x.io', name: 'First' }));
    await em1.flush();

    const em2 = orm.em.fork();
    em2.persist(em2.create(EnAccount, { email: 'dup@x.io', name: 'Second' }));
    await expect(em2.flush()).rejects.toBeInstanceOf(UniqueConstraintViolationException);
  });
});
