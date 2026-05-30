import { test, expect, mock } from 'bun:test';
import type { DatabaseConnection, TransactionSettings } from 'kysely';

import { BunSqlTransactionController } from './bun-sql-transaction';

// The SUT has no return value and no state: its entire observable contract IS the SQL
// string handed to the injected connection. Capturing executeQuery args and asserting
// the emitted .sql is therefore the behavior, not implementation coupling.
function fakeConnection() {
  const calls: string[] = [];
  const connection = {
    executeQuery: mock((cq: { sql: string }) => {
      calls.push(cq.sql);
      return Promise.resolve({ rows: [] });
    }),
  } as unknown as DatabaseConnection;
  return { connection, calls };
}

const controller = new BunSqlTransactionController();

test('begin with an isolation level emits SET ISOLATION then begin, in order', async () => {
  const { connection, calls } = fakeConnection();
  await controller.begin(connection, { isolationLevel: 'serializable' });
  expect(calls).toEqual(['set transaction isolation level serializable', 'begin']);
});

test('begin with an access mode emits SET TRANSACTION <mode> then begin', async () => {
  const { connection, calls } = fakeConnection();
  await controller.begin(connection, { accessMode: 'read only' });
  expect(calls).toEqual(['set transaction read only', 'begin']);
});

test('begin with both emits isolation, then access mode, then begin, in order', async () => {
  const { connection, calls } = fakeConnection();
  await controller.begin(connection, { isolationLevel: 'read committed', accessMode: 'read write' });
  expect(calls).toEqual([
    'set transaction isolation level read committed',
    'set transaction read write',
    'begin',
  ]);
});

test('begin with no settings emits only begin', async () => {
  const { connection, calls } = fakeConnection();
  await controller.begin(connection, {});
  expect(calls).toEqual(['begin']);
});

test('begin with an undefined isolation level skips the isolation statement', async () => {
  const { connection, calls } = fakeConnection();
  await controller.begin(connection, { isolationLevel: undefined } as unknown as TransactionSettings);
  expect(calls).toEqual(['begin']);
});

test('commit emits commit', async () => {
  const { connection, calls } = fakeConnection();
  await controller.commit(connection);
  expect(calls).toEqual(['commit']);
});

test('rollback emits rollback', async () => {
  const { connection, calls } = fakeConnection();
  await controller.rollback(connection);
  expect(calls).toEqual(['rollback']);
});

test('savepoint emits a quoted savepoint statement', async () => {
  const { connection, calls } = fakeConnection();
  await controller.savepoint(connection, 'sp1');
  expect(calls).toEqual(['savepoint "sp1"']);
});

test('rollbackToSavepoint emits a quoted rollback-to statement', async () => {
  const { connection, calls } = fakeConnection();
  await controller.rollbackToSavepoint(connection, 'sp1');
  expect(calls).toEqual(['rollback to savepoint "sp1"']);
});

test('releaseSavepoint emits a quoted release statement', async () => {
  const { connection, calls } = fakeConnection();
  await controller.releaseSavepoint(connection, 'sp1');
  expect(calls).toEqual(['release savepoint "sp1"']);
});

// RED (B2): a savepoint name containing a double-quote must be escaped (quote-doubled)
// so the identifier boundary cannot be broken. Current scaffold interpolates raw.
test('escapes a double-quote in a savepoint name', async () => {
  const { connection, calls } = fakeConnection();
  await controller.savepoint(connection, 'sp"x');
  expect(calls).toEqual(['savepoint "sp""x"']);
});
