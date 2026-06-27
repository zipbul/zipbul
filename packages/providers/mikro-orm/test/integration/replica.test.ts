import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MikroORM, type Options } from '@mikro-orm/core';
import { SqlSchemaGenerator } from '@mikro-orm/sql';

import { Entity, PrimaryKey, Property } from '../../src/entity';
import { BunPostgreSqlDriver } from '../../src/driver';
import { PG_URL, describePg } from './helpers';

// Read replicas ARE supported: MikroORM opens a SEPARATE connection per replica (each
// with its own clientUrl), and this driver creates an independent Bun.SQL client for
// each. Writes go to the primary (clientUrl); reads route to a replica connection.
// (Here primary and replica point at the same server — enough to prove the wiring,
// since the read demonstrably travels a distinct connection from the write.)
@Entity()
class RepRow {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string' })
  v!: string;
}

describePg('read replicas (postgres)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await MikroORM.init({
      driver: BunPostgreSqlDriver,
      clientUrl: PG_URL,
      entities: [RepRow],
      extensions: [SqlSchemaGenerator],
      replicas: [{ name: 'read-1', clientUrl: PG_URL }],
    } as unknown as Options);
  });
  afterAll(async () => {
    await orm.close(true);
  });
  beforeEach(async () => {
    const s = orm as unknown as { schema: { drop(o?: { dropForeignKeys?: boolean }): Promise<void>; create(): Promise<void> } };
    await s.schema.drop({ dropForeignKeys: true });
    await s.schema.create();
  });

  test('the read connection is distinct from the write connection', () => {
    const write = orm.em.getConnection('write');
    const read = orm.em.getConnection('read');
    expect(read).not.toBe(write);
  });

  test('a write goes to the primary and is readable back through a replica read', async () => {
    const em = orm.em.fork();
    em.persist(em.create(RepRow, { v: 'replicated' }));
    await em.flush();

    const found = await orm.em.fork().find(RepRow, {});
    expect(found).toHaveLength(1);
    expect(found[0]?.v).toBe('replicated');
  });
});
