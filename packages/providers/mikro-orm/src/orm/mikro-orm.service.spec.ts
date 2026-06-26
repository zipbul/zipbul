import { test, expect, mock, spyOn, afterEach } from 'bun:test';
import { MikroORM, type EntityManager } from '@mikro-orm/core';

import { ConnectionRegistry } from '../connection';
import { EntityManagerResolver, RequestContextRunner } from '../context';
import { MikroOrmErrorReason } from '../error';
import { MikroOrmService } from './mikro-orm.service';
import type { ZipbulMikroOrmOptions } from './interfaces';

afterEach(() => {
  mock.restore();
  ConnectionRegistry.delete('default');
  ConnectionRegistry.delete('analytics');
});

function fakeOrm() {
  return { close: mock(async () => {}), em: { tag: 'em' } } as unknown as MikroORM & {
    close: ReturnType<typeof mock>;
  };
}

class Database extends MikroOrmService {
  protected readonly options: ZipbulMikroOrmOptions;
  constructor(options: ZipbulMikroOrmOptions) {
    super();
    this.options = options;
  }
}

const opts = (extra: Partial<ZipbulMikroOrmOptions> = {}): ZipbulMikroOrmOptions =>
  ({ clientUrl: 'pg://h/db', ...extra }) as ZipbulMikroOrmOptions;

test('onInit initializes MikroORM and registers it under the default connection', async () => {
  const orm = fakeOrm();
  spyOn(MikroORM, 'init').mockResolvedValue(orm);
  const service = new Database(opts());
  await service.onInit();
  expect(ConnectionRegistry.get('default')).toBe(orm);
});

test('onInit registers under a named connection when one is configured', async () => {
  const orm = fakeOrm();
  spyOn(MikroORM, 'init').mockResolvedValue(orm);
  const service = new Database(opts({ connection: 'analytics' }));
  await service.onInit();
  expect(ConnectionRegistry.get('analytics')).toBe(orm);
});

test('onInit binds MikroORM contextName to the logical connection and strips the custom `connection` option', async () => {
  const init = spyOn(MikroORM, 'init').mockResolvedValue(fakeOrm());
  await new Database(opts({ connection: 'analytics' })).onInit();
  const passed = init.mock.calls[0]![0] as Record<string, unknown>;
  // contextName is what MikroORM keys the RequestContext fork by; without this a named connection
  // forks under 'default' and silently falls back to the shared global EM (cross-request leak).
  expect(passed['contextName']).toBe('analytics');
  expect('connection' in passed).toBe(false);
});

test('onInit defaults contextName to the default connection name', async () => {
  const init = spyOn(MikroORM, 'init').mockResolvedValue(fakeOrm());
  await new Database(opts()).onInit();
  expect((init.mock.calls[0]![0] as Record<string, unknown>)['contextName']).toBe('default');
});

test('onInit performs no destructive schema work (only MikroORM.init creates the orm)', async () => {
  const orm = fakeOrm();
  const init = spyOn(MikroORM, 'init').mockResolvedValue(orm);
  const service = new Database(opts());
  await service.onInit();
  expect(init).toHaveBeenCalledTimes(1);
  // a non-destructive onInit must not reach into schema/generator APIs on the orm
  expect((orm as unknown as { getSchemaGenerator?: unknown }).getSchemaGenerator).toBeUndefined();
});

test('onDestroy deregisters the connection and closes the orm', async () => {
  const orm = fakeOrm();
  spyOn(MikroORM, 'init').mockResolvedValue(orm);
  const service = new Database(opts());
  await service.onInit();
  await service.onDestroy();
  expect(ConnectionRegistry.has('default')).toBe(false);
  expect(orm.close).toHaveBeenCalledWith(true);
});

test('onDestroy before onInit does not throw and closes nothing', async () => {
  const service = new Database(opts());
  await expect(service.onDestroy()).resolves.toBeUndefined();
});

test('the em getter resolves through the EntityManagerResolver for the connection', () => {
  const resolved = { tag: 'resolved' } as unknown as EntityManager;
  const resolve = spyOn(EntityManagerResolver, 'resolve').mockReturnValue(resolved);
  const service = new Database(opts());
  expect(service.em).toBe(resolved);
  expect(resolve).toHaveBeenCalledWith('default');
});

test('enter delegates to the RequestContextRunner for the connection', () => {
  const enter = spyOn(RequestContextRunner, 'enter').mockImplementation(() => {});
  const service = new Database(opts());
  service.enter();
  expect(enter).toHaveBeenCalledWith('default');
});

test('a second onInit on an already-registered connection throws ConnectionAlreadyRegistered and builds no second orm', async () => {
  const init = spyOn(MikroORM, 'init').mockResolvedValue(fakeOrm());
  await new Database(opts()).onInit();
  expect(init).toHaveBeenCalledTimes(1);
  await expect(new Database(opts()).onInit()).rejects.toMatchObject({
    reason: MikroOrmErrorReason.ConnectionAlreadyRegistered,
  });
  expect(init).toHaveBeenCalledTimes(1); // no second pool was built
});

test('a failed MikroORM.init rejects onInit and registers nothing', async () => {
  spyOn(MikroORM, 'init').mockRejectedValue(new Error('connect failed'));
  const service = new Database(opts());
  await expect(service.onInit()).rejects.toThrow('connect failed');
  expect(ConnectionRegistry.has('default')).toBe(false);
});
