import { describe, test, expect, afterEach } from 'bun:test';
import { MikroORM, type Options } from '@mikro-orm/core';

import { Entity, PrimaryKey, Property } from '../../src/entity';
import { BunSqliteDriver } from '../../src/driver';

// sqlite is in-process (no docker). RED: BunSqlKyselyDriver.acquireConnection hardcodes
// client.reserve(), which Bun.SQL's sqlite adapter does not support, so the first query
// fails. This drives the per-DB no-reserve acquisition implementation (GREEN phase).

@Entity()
class Widget {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string', unique: true })
  sku!: string;
}

const hang = (ms: number) =>
  new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('sqlite connection acquisition hung (no-reserve gap)')), ms),
  );

describe('BunSqliteDriver (in-memory)', () => {
  let orm: MikroORM | undefined;
  afterEach(async () => {
    // The hung reserve() leaves the connection unclosable, so bound the teardown too.
    await Promise.race([orm?.close(true), hang(1500)]).catch(() => {});
    orm = undefined;
  });

  test('acquires a connection and executes a query on an in-memory database', async () => {
    orm = await MikroORM.init({
      driver: BunSqliteDriver,
      dbName: ':memory:',
      entities: [Widget],
    } as unknown as Options);

    // Forces acquireConnection() -> reserve(), which Bun.SQL sqlite does not support.
    const rows = (await Promise.race([
      orm.em.getConnection().execute('select 1 as one'),
      hang(2000),
    ])) as Array<{ one: number }>;
    expect(rows).toEqual([{ one: 1 }]);
  });
});
