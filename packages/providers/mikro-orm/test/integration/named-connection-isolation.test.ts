// A non-default named connection must still get a per-request forked EM. MikroORM keys the
// RequestContext fork by `em.name` (= contextName); MikroOrmService binds contextName to the
// logical connection name in onInit. Without that, resolve(name) misses the ALS store and silently
// returns the SHARED global EM — a cross-request identity-map leak for every non-default connection.
import { test, expect, beforeAll, afterAll } from 'bun:test';
import { RequestContext, type EntityManager } from '@mikro-orm/core';

import { Entity, PrimaryKey, Property } from '../../src/entity';
import { BunPostgreSqlDriver } from '../../src/driver';
import { MikroOrmService } from '../../src/orm';
import type { ZipbulMikroOrmOptions } from '../../src/orm/interfaces';
import { ConnectionRegistry } from '../../src/connection';
import { PG_URL, describePg } from './helpers';

@Entity()
class TenantRow {
  @PrimaryKey({ type: 'number', autoincrement: true }) id!: number;
  @Property({ type: 'string' }) v!: string;
}

class TenantDb extends MikroOrmService {
  protected readonly options: ZipbulMikroOrmOptions = {
    driver: BunPostgreSqlDriver,
    clientUrl: PG_URL!,
    entities: [TenantRow],
    connection: 'tenant-x',
  } as unknown as ZipbulMikroOrmOptions;
}

describePg('named-connection request-scoped EM isolation (postgres)', () => {
  let db: TenantDb;
  beforeAll(async () => {
    db = new TenantDb();
    await db.onInit();
  });
  afterAll(async () => {
    ConnectionRegistry.delete('tenant-x');
    await db.onDestroy();
  });

  test('contextName is bound to the logical connection name', () => {
    expect(db.orm.em.name).toBe('tenant-x');
  });

  test('outside a request context, the named connection resolves the global EM', () => {
    expect(db.em).toBe(db.orm.em as EntityManager);
  });

  test('inside a request context, the named connection resolves a distinct per-request fork', () => {
    RequestContext.create(db.orm.em, () => {
      const scoped = db.em;
      expect(scoped).not.toBe(db.orm.em as EntityManager);
    });
  });

  test('two interleaved contexts each get their own fork (no global-EM fallback)', async () => {
    const forks = await Promise.all([
      RequestContext.create(db.orm.em, async () => {
        await Promise.resolve();
        return db.em;
      }),
      RequestContext.create(db.orm.em, async () => {
        await Promise.resolve();
        return db.em;
      }),
    ]);
    expect(forks[0]).not.toBe(forks[1]);
    expect(forks[0]).not.toBe(db.orm.em as EntityManager);
    expect(forks[1]).not.toBe(db.orm.em as EntityManager);
  });
});
