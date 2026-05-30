import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { RequestContext, type MikroORM } from '@mikro-orm/core';

import { BunPostgreSqlDriver } from '../../src/driver';
import { ConnectionRegistry, ConnectionNotRegisteredError } from '../../src/connection';
import { EntityManagerResolver, RequestContextRunner } from '../../src/context';
import { PG_URL, describePg, makeOrm, freshSchema } from './helpers';

describePg('context + registry lifecycle (postgres)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await makeOrm(BunPostgreSqlDriver, PG_URL!);
    await freshSchema(orm);
  });
  afterAll(async () => {
    await orm.close(true);
    ConnectionRegistry.delete('ctx');
  });
  beforeEach(() => {
    ConnectionRegistry.delete('ctx');
  });

  test('resolve returns the per-context forked EM inside enter, and the global EM outside', () => {
    ConnectionRegistry.set('ctx', orm);
    const outside = EntityManagerResolver.resolve('ctx');
    expect(outside).toBe(orm.em);

    RequestContext.create(orm.em, () => {
      RequestContextRunner.enter('ctx');
      const inside = EntityManagerResolver.resolve('ctx');
      expect(inside).not.toBe(orm.em); // a fork, not the global EM
    });
  });

  test('two interleaved request contexts each see their own forked EM', async () => {
    ConnectionRegistry.set('ctx', orm);
    const ids = await Promise.all([
      RequestContext.create(orm.em, async () => {
        RequestContextRunner.enter('ctx');
        await Promise.resolve();
        return (EntityManagerResolver.resolve('ctx') as unknown as { id: number }).id;
      }),
      RequestContext.create(orm.em, async () => {
        RequestContextRunner.enter('ctx');
        await Promise.resolve();
        return (EntityManagerResolver.resolve('ctx') as unknown as { id: number }).id;
      }),
    ]);
    expect(ids[0]).not.toBe(ids[1]);
  });

  // S3: after onDestroy-equivalent cleanup, the connection is no longer resolvable.
  test('a deregistered connection is no longer resolvable', () => {
    ConnectionRegistry.set('ctx', orm);
    ConnectionRegistry.delete('ctx');
    expect(() => EntityManagerResolver.resolve('ctx')).toThrow(ConnectionNotRegisteredError);
  });

  // S3: two named connections coexist and resolve to their own EM.
  test('named connections coexist and resolve independently', async () => {
    const second = await makeOrm(BunPostgreSqlDriver, PG_URL!);
    try {
      ConnectionRegistry.set('ctx', orm);
      ConnectionRegistry.set('other', second);
      expect(EntityManagerResolver.resolve('ctx')).toBe(orm.em);
      expect(EntityManagerResolver.resolve('other')).toBe(second.em);
    } finally {
      ConnectionRegistry.delete('other');
      await second.close(true);
    }
  });
});
