import { test, expect, mock } from 'bun:test';
import type { CompiledQuery } from 'kysely';

import { BunSqlConnection } from './bun-sql-connection';
import { StreamingUnsupportedError } from './errors';
import type { ErrorNormalizer } from './interfaces';
import type { ReservedConnection } from './types';

// Shape VERIFIED against real Bun.SQL (integration): a DML result is the row array with
// the affected count on `.count` (NOT `.affectedRows`, which is null for pg UPDATE/DELETE)
// and the insert id on `.lastInsertRowid`. The scaffold currently reads `.affectedRows`,
// so the `.count` cases below are RED until the driver maps `.count`.

function setup(unsafeResult: unknown) {
  const reserved = {
    unsafe: mock(async () => unsafeResult),
    release: mock(() => {}),
  } as unknown as ReservedConnection & { unsafe: ReturnType<typeof mock>; release: ReturnType<typeof mock> };
  const normalizer: ErrorNormalizer = { normalize: mock((e: unknown) => e) };
  return { reserved, normalizer, connection: new BunSqlConnection(reserved, normalizer) };
}

const cq = (sql: string, parameters: readonly unknown[] = []): CompiledQuery =>
  ({ sql, parameters, query: {} }) as unknown as CompiledQuery;

test('maps a plain row array to { rows } with no affected/insert keys', async () => {
  const { connection } = setup([{ id: 1 }]);
  const result = await connection.executeQuery(cq('select 1'));
  expect(result).toEqual({ rows: [{ id: 1 }] });
});

test('maps the affected count to numAffectedRows as a BigInt', async () => {
  const rows = Object.assign([] as unknown[], { count: 5, affectedRows: null });
  const { connection } = setup(rows);
  const result = await connection.executeQuery(cq('update t'));
  expect(result.numAffectedRows).toBe(5n);
});

test('maps lastInsertRowid to insertId as a BigInt', async () => {
  const rows = Object.assign([] as unknown[], { lastInsertRowid: 42 });
  const { connection } = setup(rows);
  const result = await connection.executeQuery(cq('insert t'));
  expect(result.insertId).toBe(42n);
});

test('includes numAffectedRows when the count is 0 (boundary, not omitted)', async () => {
  const rows = Object.assign([] as unknown[], { count: 0, affectedRows: null });
  const { connection } = setup(rows);
  const result = await connection.executeQuery(cq('update t'));
  expect(result.numAffectedRows).toBe(0n);
});

test('includes insertId when lastInsertRowid is 0 (boundary, not omitted)', async () => {
  const rows = Object.assign([] as unknown[], { lastInsertRowid: 0 });
  const { connection } = setup(rows);
  const result = await connection.executeQuery(cq('insert t'));
  expect(result.insertId).toBe(0n);
});

test('returns empty rows when the driver resolves to undefined', async () => {
  const { connection } = setup(undefined);
  const result = await connection.executeQuery(cq('select 1'));
  expect(result.rows).toEqual([]);
});

test('returns empty rows when the driver resolves to a non-array object', async () => {
  const { connection } = setup({});
  const result = await connection.executeQuery(cq('select 1'));
  expect(result.rows).toEqual([]);
});

test('passes the compiled SQL and a fresh parameters array to the driver', async () => {
  const { connection, reserved } = setup([]);
  await connection.executeQuery(cq('select $1', [1, 'x']));
  expect(reserved.unsafe).toHaveBeenCalledWith('select $1', [1, 'x']);
});

test('rethrows exactly the normalized error when the driver rejects', async () => {
  const sentinel = new Error('normalized');
  const reserved = {
    unsafe: mock(async () => {
      throw new Error('raw');
    }),
    release: mock(() => {}),
  } as unknown as ReservedConnection;
  const normalizer: ErrorNormalizer = { normalize: mock(() => sentinel) };
  const connection = new BunSqlConnection(reserved, normalizer);
  await expect(connection.executeQuery(cq('select 1'))).rejects.toBe(sentinel);
});

test('streamQuery rejects with StreamingUnsupportedError when the iterator is driven', async () => {
  const { connection } = setup([]);
  await expect(connection.streamQuery().next()).rejects.toThrow(StreamingUnsupportedError);
});

test('release releases the reserved connection', async () => {
  const { connection, reserved } = setup([]);
  await connection.release();
  expect(reserved.release).toHaveBeenCalled();
});
