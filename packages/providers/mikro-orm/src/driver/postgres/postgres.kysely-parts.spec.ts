import { test, expect } from 'bun:test';
import { PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, type Kysely } from 'kysely';

import { POSTGRES_KYSELY_PARTS } from './postgres.kysely-parts';

// Locks the per-DB variation point: the Postgres trio must hand BunSqlDialect the
// Postgres-flavoured Kysely adapter/compiler/introspector (not another dialect's).
test('createQueryCompiler builds a PostgresQueryCompiler', () => {
  expect(POSTGRES_KYSELY_PARTS.createQueryCompiler()).toBeInstanceOf(PostgresQueryCompiler);
});

test('createAdapter builds a PostgresAdapter', () => {
  expect(POSTGRES_KYSELY_PARTS.createAdapter()).toBeInstanceOf(PostgresAdapter);
});

test('createIntrospector builds a PostgresIntrospector bound to the db', () => {
  const db = {} as unknown as Kysely<unknown>;
  expect(POSTGRES_KYSELY_PARTS.createIntrospector(db)).toBeInstanceOf(PostgresIntrospector);
});
