import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { MikroORM } from '@mikro-orm/core';

import { BunPostgreSqlDriver } from '../../src/driver';
import { StreamingUnsupportedError } from '../../src/bun-sql';
import {PG_URL, describePg, makeOrm, freshSchema} from './helpers';
import { Entity, PrimaryKey, Property } from '../../src/entity';

@Entity()
class RtAccount {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string', unique: true })
  email!: string;

  @Property({ type: 'string' })
  name!: string;
}

describePg('round-trip (postgres)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await makeOrm(BunPostgreSqlDriver, PG_URL!, [RtAccount]);
  });
  afterAll(async () => {
    await orm.close(true);
  });
  beforeEach(async () => {
    await freshSchema(orm);
  });

  test('insert returns a generated id and the row is readable back', async () => {
    const em = orm.em.fork();
    const account = em.create(RtAccount, { email: 'a@x.io', name: 'Ada' });
    em.persist(account);
    await em.flush();
    expect(account.id).toBeGreaterThan(0);

    const found = await orm.em.fork().findOneOrFail(RtAccount, { email: 'a@x.io' });
    expect(found.name).toBe('Ada');
  });

  test('update reports the affected row count', async () => {
    const em = orm.em.fork();
    em.persist(em.create(RtAccount, { email: 'b@x.io', name: 'Old' }));
    await em.flush();

    const affected = await orm.em.fork().nativeUpdate(RtAccount, { email: 'b@x.io' }, { name: 'New' });
    expect(affected).toBe(1);
  });

  test('delete reports the affected row count', async () => {
    const em = orm.em.fork();
    em.persist(em.create(RtAccount, { email: 'c@x.io', name: 'Gone' }));
    await em.flush();

    const affected = await orm.em.fork().nativeDelete(RtAccount, { email: 'c@x.io' });
    expect(affected).toBe(1);
  });

  // MikroORM v7 DOES expose streaming (qb.stream / connection.stream, pg cursor-based).
  // Bun.SQL has no cursor, so driving it must surface the typed unsupported error end-to-end
  // (fast — verified ~250ms, not a hang), proving the explicit-unsupported contract.
  test('streaming through MikroORM surfaces StreamingUnsupportedError', async () => {
    const conn = orm.em.getConnection() as unknown as {
      stream(query: string, params?: readonly unknown[]): AsyncIterableIterator<unknown>;
    };
    await expect(
      (async () => {
        for await (const _row of conn.stream('select 1 as one', [])) {
          /* drive the iterator */
        }
      })(),
    ).rejects.toThrow(StreamingUnsupportedError);
  });
});
