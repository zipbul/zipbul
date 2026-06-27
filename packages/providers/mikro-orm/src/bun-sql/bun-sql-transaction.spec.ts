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

const controller = new BunSqlTransactionController('postgres');
const mysqlController = new BunSqlTransactionController('mysql');
const sqliteController = new BunSqlTransactionController('sqlite');

// --- postgres: the mode must be part of BEGIN (SET TRANSACTION before BEGIN is silently
// ignored by postgres, which would run the txn at the session default). ---
test('postgres begin with an isolation level composes it into BEGIN', async () => {
  const { connection, calls } = fakeConnection();
  await controller.begin(connection, { isolationLevel: 'serializable' });
  expect(calls).toEqual(['begin isolation level serializable']);
});

test('postgres begin with an access mode composes it into BEGIN', async () => {
  const { connection, calls } = fakeConnection();
  await controller.begin(connection, { accessMode: 'read only' });
  expect(calls).toEqual(['begin read only']);
});

test('postgres begin with both composes isolation then access mode into a single BEGIN', async () => {
  const { connection, calls } = fakeConnection();
  await controller.begin(connection, { isolationLevel: 'read committed', accessMode: 'read write' });
  expect(calls).toEqual(['begin isolation level read committed read write']);
});

test('postgres begin with no settings emits only begin', async () => {
  const { connection, calls } = fakeConnection();
  await controller.begin(connection, {});
  expect(calls).toEqual(['begin']);
});

test('postgres begin with an undefined isolation level skips the mode', async () => {
  const { connection, calls } = fakeConnection();
  await controller.begin(connection, { isolationLevel: undefined } as unknown as TransactionSettings);
  expect(calls).toEqual(['begin']);
});

// --- mysql: SET TRANSACTION ISOLATION LEVEL must precede START TRANSACTION; the access
// mode is supplied inline on START TRANSACTION. ---
test('mysql begin with an isolation level emits SET ISOLATION before begin', async () => {
  const { connection, calls } = fakeConnection();
  await mysqlController.begin(connection, { isolationLevel: 'serializable' });
  expect(calls).toEqual(['set transaction isolation level serializable', 'begin']);
});

test('mysql begin with an access mode emits START TRANSACTION <mode>', async () => {
  const { connection, calls } = fakeConnection();
  await mysqlController.begin(connection, { accessMode: 'read only' });
  expect(calls).toEqual(['start transaction read only']);
});

test('mysql begin with both emits SET ISOLATION then START TRANSACTION <mode>', async () => {
  const { connection, calls } = fakeConnection();
  await mysqlController.begin(connection, { isolationLevel: 'repeatable read', accessMode: 'read write' });
  expect(calls).toEqual(['set transaction isolation level repeatable read', 'start transaction read write']);
});

// --- sqlite: isolation level / access mode are not expressible; a plain BEGIN is opened. ---
test('sqlite begin ignores isolation level and access mode, emitting a plain begin', async () => {
  const { connection, calls } = fakeConnection();
  await sqliteController.begin(connection, { isolationLevel: 'serializable', accessMode: 'read only' });
  expect(calls).toEqual(['begin']);
});

// --- validation: an unknown isolation level / access mode is rejected before it reaches SQL. ---
test('begin rejects an unknown isolation level', async () => {
  const { connection } = fakeConnection();
  await expect(
    controller.begin(connection, { isolationLevel: 'snapshot' } as unknown as TransactionSettings),
  ).rejects.toThrow('unsupported transaction isolation level');
});

test('begin rejects an unknown access mode', async () => {
  const { connection } = fakeConnection();
  await expect(
    controller.begin(connection, { accessMode: 'read sideways' } as unknown as TransactionSettings),
  ).rejects.toThrow('unsupported transaction access mode');
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
test('escapes a double-quote in a savepoint name (postgres/sqlite)', async () => {
  const { connection, calls } = fakeConnection();
  await controller.savepoint(connection, 'sp"x');
  expect(calls).toEqual(['savepoint "sp""x"']);
});

// --- mysql/mariadb: savepoint identifiers MUST be backtick-quoted. A double-quoted token is a
// string literal under the default sql_mode (no ANSI_QUOTES), so `SAVEPOINT "x"` is ER_PARSE_ERROR
// — this is what silently broke every MySQL/MariaDB nested transaction before the dialect fix. ---
test('mysql savepoint uses backticks, not double quotes', async () => {
  const { connection, calls } = fakeConnection();
  await mysqlController.savepoint(connection, 'sp1');
  expect(calls).toEqual(['savepoint `sp1`']);
});

test('mysql rollbackToSavepoint uses backticks', async () => {
  const { connection, calls } = fakeConnection();
  await mysqlController.rollbackToSavepoint(connection, 'sp1');
  expect(calls).toEqual(['rollback to savepoint `sp1`']);
});

test('mysql releaseSavepoint uses backticks', async () => {
  const { connection, calls } = fakeConnection();
  await mysqlController.releaseSavepoint(connection, 'sp1');
  expect(calls).toEqual(['release savepoint `sp1`']);
});

test('mysql savepoint escapes an embedded backtick by doubling it', async () => {
  const { connection, calls } = fakeConnection();
  await mysqlController.savepoint(connection, 'sp`x');
  expect(calls).toEqual(['savepoint `sp``x`']);
});
