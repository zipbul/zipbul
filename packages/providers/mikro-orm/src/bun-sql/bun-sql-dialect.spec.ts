import { test, expect, mock } from 'bun:test';
import type { Kysely, QueryCompiler, DialectAdapter, DatabaseIntrospector } from 'kysely';

import { BunSqlDialect } from './bun-sql-dialect';
import { BunSqlKyselyDriver } from './bun-sql-kysely-driver';
import { DEFAULT_POOL_MAX } from './constants';
import type { KyselyDialectParts, ErrorNormalizer, BunSqlDialectOptions } from './interfaces';
import type { BunSqlClient } from './types';

const normalizer: ErrorNormalizer = { normalize: (e) => e };

function fakeParts() {
  const compiler = { kind: 'compiler' } as unknown as QueryCompiler;
  const adapter = { kind: 'adapter' } as unknown as DialectAdapter;
  const introspector = { kind: 'introspector' } as unknown as DatabaseIntrospector;
  return {
    parts: {
      createQueryCompiler: mock(() => compiler),
      createAdapter: mock(() => adapter),
      createIntrospector: mock(() => introspector),
    } as unknown as KyselyDialectParts & {
      createQueryCompiler: ReturnType<typeof mock>;
      createAdapter: ReturnType<typeof mock>;
      createIntrospector: ReturnType<typeof mock>;
    },
    compiler,
    adapter,
    introspector,
  };
}

const fakeClient = () => ({ reserve: mock(), close: mock() }) as unknown as BunSqlClient;

test('createQueryCompiler delegates to the injected parts', () => {
  const { parts, compiler } = fakeParts();
  const dialect = new BunSqlDialect(parts, normalizer, { url: 'u', dialect: 'postgres' });
  expect(dialect.createQueryCompiler()).toBe(compiler);
});

test('createAdapter delegates to the injected parts', () => {
  const { parts, adapter } = fakeParts();
  const dialect = new BunSqlDialect(parts, normalizer, { url: 'u', dialect: 'postgres' });
  expect(dialect.createAdapter()).toBe(adapter);
});

test('createIntrospector passes the db through and returns the parts result', () => {
  const { parts, introspector } = fakeParts();
  const dialect = new BunSqlDialect(parts, normalizer, { url: 'u', dialect: 'postgres' });
  const db = { kind: 'db' } as unknown as Kysely<unknown>;
  expect(dialect.createIntrospector(db)).toBe(introspector);
  expect(parts.createIntrospector).toHaveBeenCalledWith(db);
});

test('createDriver returns a BunSqlKyselyDriver', () => {
  const { parts } = fakeParts();
  const options: BunSqlDialectOptions = { url: 'u', dialect: 'postgres', createClient: fakeClient };
  const dialect = new BunSqlDialect(parts, normalizer, options);
  expect(dialect.createDriver()).toBeInstanceOf(BunSqlKyselyDriver);
});

test('createDriver wires the provided createClient and poolMax into the driver', async () => {
  const { parts } = fakeParts();
  const createClient = mock((_url: string, _max: number) => fakeClient());
  const dialect = new BunSqlDialect(parts, normalizer, { url: 'pg://h', dialect: 'postgres', poolMax: 3, createClient });
  await dialect.createDriver().init();
  expect(createClient).toHaveBeenCalledWith('pg://h', 3);
});

test('createDriver falls back to DEFAULT_POOL_MAX when poolMax is omitted', async () => {
  const { parts } = fakeParts();
  const createClient = mock((_url: string, _max: number) => fakeClient());
  const dialect = new BunSqlDialect(parts, normalizer, { url: 'pg://h', dialect: 'postgres', createClient });
  await dialect.createDriver().init();
  expect(createClient).toHaveBeenCalledWith('pg://h', DEFAULT_POOL_MAX);
});
