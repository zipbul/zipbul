import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { RequestContext, type EntityManager, type MikroORM } from '@mikro-orm/core';

import { BunPostgreSqlDriver } from '../../src/driver';
import { ConnectionRegistry, ConnectionNotRegisteredError, DEFAULT_CONNECTION } from '../../src/connection';
import { EntityManagerResolver } from '../../src/context';
import { PG_URL, describePg, makeOrm, freshSchema } from './helpers';

describePg('context + registry lifecycle (postgres)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await makeOrm(BunPostgreSqlDriver, PG_URL!);
    await freshSchema(orm);
  });
  afterAll(async () => {
    await orm.close(true);
    ConnectionRegistry.delete(DEFAULT_CONNECTION);
    ConnectionRegistry.delete('other');
  });
  beforeEach(() => {
    ConnectionRegistry.delete(DEFAULT_CONNECTION);
    ConnectionRegistry.delete('other');
  });

  test('resolve returns the global EM outside any request context', () => {
    ConnectionRegistry.set(DEFAULT_CONNECTION, orm);
    expect(EntityManagerResolver.resolve(DEFAULT_CONNECTION)).toBe(orm.em);
  });

  test('resolve returns a per-request fork inside an entered context', () => {
    ConnectionRegistry.set(DEFAULT_CONNECTION, orm);
    RequestContext.create(orm.em, () => {
      const inside = EntityManagerResolver.resolve(DEFAULT_CONNECTION);
      expect(inside).not.toBe(orm.em);
    });
  });

  test('two interleaved request contexts each resolve their own forked EM', async () => {
    ConnectionRegistry.set(DEFAULT_CONNECTION, orm);
    const forks = await Promise.all([
      RequestContext.create(orm.em, async () => {
        await Promise.resolve();
        return EntityManagerResolver.resolve(DEFAULT_CONNECTION);
      }),
      RequestContext.create(orm.em, async () => {
        await Promise.resolve();
        return EntityManagerResolver.resolve(DEFAULT_CONNECTION);
      }),
    ]);
    expect(forks[0]).not.toBe(forks[1]);
  });

  test('a deregistered connection is no longer resolvable', () => {
    ConnectionRegistry.set(DEFAULT_CONNECTION, orm);
    ConnectionRegistry.delete(DEFAULT_CONNECTION);
    expect(() => EntityManagerResolver.resolve(DEFAULT_CONNECTION)).toThrow(ConnectionNotRegisteredError);
  });

  test('named connections coexist and resolve to their own global EM', async () => {
    const second = await makeOrm(BunPostgreSqlDriver, PG_URL!);
    try {
      ConnectionRegistry.set(DEFAULT_CONNECTION, orm);
      ConnectionRegistry.set('other', second);
      expect(EntityManagerResolver.resolve(DEFAULT_CONNECTION)).toBe(orm.em as EntityManager);
      expect(EntityManagerResolver.resolve('other')).toBe(second.em as EntityManager);
    } finally {
      ConnectionRegistry.delete('other');
      await second.close(true);
    }
  });
});
