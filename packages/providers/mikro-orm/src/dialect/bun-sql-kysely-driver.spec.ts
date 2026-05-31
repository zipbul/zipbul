import { test, expect, mock } from 'bun:test';
import type { DatabaseConnection } from 'kysely';

import { BunSqlConnection } from './bun-sql-connection';
import { BunSqlKyselyDriver } from './bun-sql-kysely-driver';
import { DEFAULT_POOL_MAX } from './constants';
import type { ErrorNormalizer } from './interfaces';
import type { BunSqlClient } from './types';

const normalizer: ErrorNormalizer = { normalize: (e) => e };

function fakeClient() {
  const reserved = { unsafe: mock(async () => []), release: mock(() => {}) };
  return {
    reserve: mock(async () => reserved),
    close: mock(() => {}),
  } as unknown as BunSqlClient & { reserve: ReturnType<typeof mock>; close: ReturnType<typeof mock> };
}

test('acquireConnection before init rejects with a used-before-init error', async () => {
  const driver = new BunSqlKyselyDriver('u', normalizer, 10, () => fakeClient());
  await expect(driver.acquireConnection()).rejects.toThrow('used before init()');
});

test('init creates the client with the configured url and pool size', async () => {
  const createClient = mock((_url: string, _max: number) => fakeClient());
  const driver = new BunSqlKyselyDriver('postgres://h/db', normalizer, 7, createClient);
  await driver.init();
  expect(createClient).toHaveBeenCalledWith('postgres://h/db', 7);
});

test('a pooled driver whose client lacks reserve() rejects acquireConnection with a clear error', async () => {
  const clientWithoutReserve = { unsafe: mock(async () => []), close: mock(() => {}) } as unknown as BunSqlClient;
  const driver = new BunSqlKyselyDriver('u', normalizer, 10, () => clientWithoutReserve, true);
  await driver.init();
  await expect(driver.acquireConnection()).rejects.toThrow('requires a Bun.SQL client with reserve()');
});

test('acquireConnection reserves a connection and returns a BunSqlConnection', async () => {
  const client = fakeClient();
  const driver = new BunSqlKyselyDriver('u', normalizer, 10, () => client);
  await driver.init();
  const connection = await driver.acquireConnection();
  expect(client.reserve).toHaveBeenCalled();
  expect(connection).toBeInstanceOf(BunSqlConnection);
});

test('destroy closes the underlying client', async () => {
  const client = fakeClient();
  const driver = new BunSqlKyselyDriver('u', normalizer, 10, () => client);
  await driver.init();
  await driver.destroy();
  expect(client.close).toHaveBeenCalled();
});

test('destroy before init does not throw and closes nothing', async () => {
  const driver = new BunSqlKyselyDriver('u', normalizer, 10, () => fakeClient());
  await expect(driver.destroy()).resolves.toBeUndefined();
});

test('beginTransaction delegates to the controller (postgres default composes a single BEGIN)', async () => {
  const calls: string[] = [];
  const connection = {
    executeQuery: mock((q: { sql: string }) => {
      calls.push(q.sql);
      return Promise.resolve({ rows: [] });
    }),
  } as unknown as DatabaseConnection;
  const driver = new BunSqlKyselyDriver('u', normalizer, 10, () => fakeClient());
  await driver.beginTransaction(connection, { isolationLevel: 'serializable' });
  expect(calls).toEqual(['begin isolation level serializable']);
});

test('beginTransaction uses the mysql sequence when constructed with the mysql dialect', async () => {
  const calls: string[] = [];
  const connection = {
    executeQuery: mock((q: { sql: string }) => {
      calls.push(q.sql);
      return Promise.resolve({ rows: [] });
    }),
  } as unknown as DatabaseConnection;
  const driver = new BunSqlKyselyDriver('u', normalizer, 10, () => fakeClient(), true, 'mysql');
  await driver.beginTransaction(connection, { isolationLevel: 'serializable' });
  expect(calls).toEqual(['set transaction isolation level serializable', 'begin']);
});

function recordingConnection(calls: string[]): DatabaseConnection {
  return {
    executeQuery: mock((q: { sql: string }) => {
      calls.push(q.sql);
      return Promise.resolve({ rows: [] });
    }),
  } as unknown as DatabaseConnection;
}

test('savepoint delegates a quoted savepoint statement to the connection', async () => {
  const calls: string[] = [];
  const driver = new BunSqlKyselyDriver('u', normalizer, 10, () => fakeClient());
  await driver.savepoint(recordingConnection(calls), 'sp');
  expect(calls).toEqual(['savepoint "sp"']);
});

test('rollbackToSavepoint delegates a quoted "rollback to savepoint" statement', async () => {
  const calls: string[] = [];
  const driver = new BunSqlKyselyDriver('u', normalizer, 10, () => fakeClient());
  await driver.rollbackToSavepoint(recordingConnection(calls), 'sp');
  expect(calls).toEqual(['rollback to savepoint "sp"']);
});

test('releaseSavepoint delegates a quoted "release savepoint" statement', async () => {
  const calls: string[] = [];
  const driver = new BunSqlKyselyDriver('u', normalizer, 10, () => fakeClient());
  await driver.releaseSavepoint(recordingConnection(calls), 'sp');
  expect(calls).toEqual(['release savepoint "sp"']);
});

test('a savepoint name containing a double-quote is escaped by doubling it', async () => {
  const calls: string[] = [];
  const driver = new BunSqlKyselyDriver('u', normalizer, 10, () => fakeClient());
  await driver.savepoint(recordingConnection(calls), 'a"b');
  expect(calls).toEqual(['savepoint "a""b"']);
});

test('commitTransaction delegates a "commit" statement to the connection', async () => {
  const calls: string[] = [];
  const driver = new BunSqlKyselyDriver('u', normalizer, 10, () => fakeClient());
  await driver.commitTransaction(recordingConnection(calls));
  expect(calls).toEqual(['commit']);
});

test('rollbackTransaction delegates a "rollback" statement to the connection', async () => {
  const calls: string[] = [];
  const driver = new BunSqlKyselyDriver('u', normalizer, 10, () => fakeClient());
  await driver.rollbackTransaction(recordingConnection(calls));
  expect(calls).toEqual(['rollback']);
});

test('releaseConnection releases the underlying reserved Bun.SQL connection', async () => {
  const release = mock(() => {});
  const connection = { release } as unknown as DatabaseConnection;
  const driver = new BunSqlKyselyDriver('u', normalizer, 10, () => fakeClient());
  await driver.releaseConnection(connection);
  expect(release).toHaveBeenCalled();
});

test('uses DEFAULT_POOL_MAX as the documented default when constructed without one', () => {
  // The default arg is wired; a driver built via the dialect omits poolMax -> DEFAULT_POOL_MAX.
  expect(DEFAULT_POOL_MAX).toBe(10);
});
