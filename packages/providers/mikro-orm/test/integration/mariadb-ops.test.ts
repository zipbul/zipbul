import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MikroORM, type Options } from '@mikro-orm/core';
import { SqlSchemaGenerator } from '@mikro-orm/sql';

import { Entity, PrimaryKey, Property } from '../../src/entity';
import { BunMariaDbDriver } from '../../src/driver';
import { MARIADB_URL, describeMariadb } from './helpers';

// Operational features on MariaDB: read-replica connection routing and graceful-shutdown drain.
@Entity()
class OpsRow {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string' })
  v!: string;
}

describeMariadb('read replicas (mariadb)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await MikroORM.init({
      driver: BunMariaDbDriver,
      clientUrl: MARIADB_URL,
      entities: [OpsRow],
      extensions: [SqlSchemaGenerator],
      replicas: [{ name: 'read-1', clientUrl: MARIADB_URL }],
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
    expect(orm.em.getConnection('read')).not.toBe(orm.em.getConnection('write'));
  });

  test('a write goes to the primary and is readable back through a replica read', async () => {
    const em = orm.em.fork();
    em.persist(em.create(OpsRow, { v: 'replicated' }));
    await em.flush();
    const found = await orm.em.fork().find(OpsRow, {});
    expect(found).toHaveLength(1);
    expect(found[0]?.v).toBe('replicated');
  });
});

describeMariadb('graceful shutdown drain (mariadb)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await MikroORM.init({ driver: BunMariaDbDriver, clientUrl: MARIADB_URL, entities: [OpsRow] } as unknown as Options);
  });
  afterAll(async () => {
    await orm.close(true).catch(() => undefined);
  });

  test('close(true) drains an in-flight query instead of severing it', async () => {
    const inflight = orm.em.getConnection().execute('select sleep(0.4) as s, 42 as v') as Promise<Array<{ v: number }>>;
    await new Promise((resolve) => setTimeout(resolve, 50));
    await orm.close(true);
    const rows = await inflight;
    expect(rows[0]?.v).toBe(42);
  });
});
