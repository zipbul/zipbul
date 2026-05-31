import { test, expect, spyOn, afterEach, mock } from 'bun:test';
import { RequestContext, type EntityManager, type MikroORM } from '@mikro-orm/core';

import { ConnectionRegistry } from '../connection';
import { EntityManagerResolver } from './entity-manager-resolver';

afterEach(() => {
  mock.restore();
});

const em = (tag: string) => ({ tag }) as unknown as EntityManager;

test('returns the request-scoped EM when one is active, without consulting the registry', () => {
  const scoped = em('scoped');
  spyOn(RequestContext, 'getEntityManager').mockReturnValue(scoped);
  const registryGet = spyOn(ConnectionRegistry, 'get');
  expect(EntityManagerResolver.resolve('default')).toBe(scoped);
  expect(registryGet).not.toHaveBeenCalled();
});

test('falls back to the global EM when no request scope is active', () => {
  const global = em('global');
  spyOn(RequestContext, 'getEntityManager').mockReturnValue(undefined);
  spyOn(ConnectionRegistry, 'get').mockReturnValue({ em: global } as unknown as MikroORM);
  expect(EntityManagerResolver.resolve('default')).toBe(global);
});

test('treats a null request EM as nullish and falls back to global', () => {
  const global = em('global');
  spyOn(RequestContext, 'getEntityManager').mockReturnValue(null as unknown as EntityManager);
  spyOn(ConnectionRegistry, 'get').mockReturnValue({ em: global } as unknown as MikroORM);
  expect(EntityManagerResolver.resolve('default')).toBe(global);
});

test('propagates a registry error when there is no scope and no registered connection', () => {
  spyOn(RequestContext, 'getEntityManager').mockReturnValue(undefined);
  spyOn(ConnectionRegistry, 'get').mockImplementation(() => {
    throw new Error('not registered');
  });
  expect(() => EntityManagerResolver.resolve('default')).toThrow('not registered');
});
