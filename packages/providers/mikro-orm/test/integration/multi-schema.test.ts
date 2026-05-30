import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MikroORM, type Options } from '@mikro-orm/core';

import { Entity, PrimaryKey, Property } from '../../src/entity';
import { BunPostgreSqlDriver } from '../../src/driver';
import { PG_URL, describePg } from './helpers';

@Entity({ schema: 'tenant_a' })
class TenantDoc {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string' })
  title!: string;
}

describePg('multiple schemas (postgres)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await MikroORM.init({ driver: BunPostgreSqlDriver, clientUrl: PG_URL, entities: [TenantDoc] } as unknown as Options);
  });
  afterAll(async () => {
    const c = orm.em.getConnection();
    await c.execute('drop schema if exists tenant_a cascade').catch(() => undefined);
    await orm.close(true);
  });
  beforeEach(async () => {
    const s = orm as unknown as { schema: { drop(o?: { dropForeignKeys?: boolean }): Promise<void>; create(): Promise<void> } };
    await s.schema.drop({ dropForeignKeys: true });
    await s.schema.create();
  });

  test('an entity bound to a non-public schema round-trips', async () => {
    const em = orm.em.fork();
    em.persist(em.create(TenantDoc, { title: 'in-tenant-a' }));
    await em.flush();
    const found = await orm.em.fork().findOneOrFail(TenantDoc, { title: 'in-tenant-a' });
    expect(found.id).toBeGreaterThan(0);
  });
});
