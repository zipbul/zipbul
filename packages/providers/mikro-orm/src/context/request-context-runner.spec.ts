import { test, expect, spyOn, afterEach, mock } from 'bun:test';
import { RequestContext, type EntityManager, type MikroORM } from '@mikro-orm/core';

import { ConnectionRegistry } from '../connection';
import { RequestContextRunner } from './request-context-runner';

afterEach(() => {
  mock.restore();
});

test('enters a MikroORM RequestContext bound to the connection global EM', () => {
  const globalEm = { tag: 'em' } as unknown as EntityManager;
  spyOn(ConnectionRegistry, 'get').mockReturnValue({ em: globalEm } as unknown as MikroORM);
  const enter = spyOn(RequestContext, 'enter').mockImplementation(() => {});
  RequestContextRunner.enter('default');
  // Entering the ALS with the right EM IS the behavior, so asserting the call is correct.
  expect(enter).toHaveBeenCalledWith(globalEm);
});

test('looks up the EM by the GIVEN connection name (not a hardcoded default)', () => {
  const get = spyOn(ConnectionRegistry, 'get').mockReturnValue({
    em: { tag: 'analytics-em' } as unknown as EntityManager,
  } as unknown as MikroORM);
  spyOn(RequestContext, 'enter').mockImplementation(() => {});
  RequestContextRunner.enter('analytics');
  expect(get).toHaveBeenCalledWith('analytics');
});

test('propagates a registry error and does not enter a context', () => {
  spyOn(ConnectionRegistry, 'get').mockImplementation(() => {
    throw new Error('not registered');
  });
  const enter = spyOn(RequestContext, 'enter').mockImplementation(() => {});
  expect(() => RequestContextRunner.enter('default')).toThrow('not registered');
  expect(enter).not.toHaveBeenCalled();
});
