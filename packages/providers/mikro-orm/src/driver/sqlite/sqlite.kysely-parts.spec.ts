import { test, expect } from 'bun:test';
import { SqliteAdapter, SqliteIntrospector, SqliteQueryCompiler, type Kysely } from 'kysely';

import { SQLITE_KYSELY_PARTS } from './sqlite.kysely-parts';

// Locks the per-DB variation point: the SQLite trio must hand the dialect the
// SQLite-flavoured Kysely adapter/compiler/introspector (not another dialect's).
test('createQueryCompiler builds a SqliteQueryCompiler', () => {
  expect(SQLITE_KYSELY_PARTS.createQueryCompiler()).toBeInstanceOf(SqliteQueryCompiler);
});

test('createAdapter builds a SqliteAdapter', () => {
  expect(SQLITE_KYSELY_PARTS.createAdapter()).toBeInstanceOf(SqliteAdapter);
});

test('createIntrospector builds a SqliteIntrospector bound to the db', () => {
  const db = {} as unknown as Kysely<unknown>;
  expect(SQLITE_KYSELY_PARTS.createIntrospector(db)).toBeInstanceOf(SqliteIntrospector);
});
