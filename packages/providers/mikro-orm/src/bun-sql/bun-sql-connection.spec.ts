import { test, expect, mock } from 'bun:test';
import type { CompiledQuery } from 'kysely';

import { BunSqlConnection } from './bun-sql-connection';
import { StreamingUnsupportedError } from './errors';
import type { ErrorNormalizer } from './interfaces';
import type { ReservedConnection } from './types';

// Shape VERIFIED against real Bun.SQL (integration): a DML result is the row array carrying the
// affected count on `.affectedRows` (mysql, with `.count` = 0) OR on `.count` (pg, `.affectedRows`
// null), and the insert id on `.lastInsertRowid`. The connection prefers `.affectedRows`, falling
// back to `.count`, and maps both to a BigInt `numAffectedRows`.

function setup(unsafeResult: unknown, normalizeBigInts = false) {
  const reserved = {
    unsafe: mock(async () => unsafeResult),
    release: mock(() => {}),
  } as unknown as ReservedConnection & { unsafe: ReturnType<typeof mock>; release: ReturnType<typeof mock> };
  const normalizer: ErrorNormalizer = { normalize: mock((e: unknown) => e) };
  return { reserved, normalizer, connection: new BunSqlConnection(reserved, normalizer, normalizeBigInts) };
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

test('prefers affectedRows over count (mysql shape: affectedRows set, count 0)', async () => {
  const rows = Object.assign([] as unknown[], { affectedRows: 3, count: 0 });
  const { connection } = setup(rows);
  const result = await connection.executeQuery(cq('update t'));
  expect(result.numAffectedRows).toBe(3n);
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

test('passes the compiled SQL and a fresh (copied) parameters array to the driver', async () => {
  const { connection, reserved } = setup([]);
  const params = [1, 'x'];
  await connection.executeQuery(cq('select $1', params));
  expect(reserved.unsafe).toHaveBeenCalledWith('select $1', [1, 'x']);
  // a COPY, not the caller's array (so Bun.SQL can't mutate Kysely's parameter list)
  expect((reserved.unsafe.mock.calls[0]![1] as unknown[])).not.toBe(params);
});

// --- bigint coercion (normalizeBigInts=true, the SQLite safeIntegers path) ---
test('coerces a safe-range bigint cell back to a number', async () => {
  const { connection } = setup([{ id: 5n }], true);
  const result = await connection.executeQuery<{ id: number }>(cq('select 1'));
  expect(result.rows[0]).toEqual({ id: 5 });
  expect(typeof result.rows[0]!.id).toBe('number');
});

test('renders a bigint past MAX_SAFE_INTEGER as a decimal string (no precision loss)', async () => {
  const { connection } = setup([{ big: 9007199254740993n }], true);
  const result = await connection.executeQuery<{ big: string }>(cq('select 1'));
  expect(result.rows[0]!.big).toBe('9007199254740993');
});

test('keeps the MAX_SAFE_INTEGER boundary as a number', async () => {
  const { connection } = setup([{ n: BigInt(Number.MAX_SAFE_INTEGER) }], true);
  const result = await connection.executeQuery<{ n: number }>(cq('select 1'));
  expect(result.rows[0]!.n).toBe(Number.MAX_SAFE_INTEGER);
  expect(typeof result.rows[0]!.n).toBe('number');
});

test('leaves non-bigint cells untouched when normalizing', async () => {
  const { connection } = setup([{ a: 'x', b: 2, c: null }], true);
  const result = await connection.executeQuery(cq('select 1'));
  expect(result.rows[0]).toEqual({ a: 'x', b: 2, c: null });
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
