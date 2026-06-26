import { test, expect } from 'bun:test';
import { MysqlAdapter, MysqlIntrospector, MysqlQueryCompiler, type Kysely } from 'kysely';

import { MYSQL_KYSELY_PARTS } from './mysql.kysely-parts';

// Locks the per-DB variation point: the MySQL trio must hand BunSqlDialect the
// MySQL-flavoured Kysely adapter/compiler/introspector (not another dialect's).
test('createQueryCompiler builds a MysqlQueryCompiler', () => {
  expect(MYSQL_KYSELY_PARTS.createQueryCompiler()).toBeInstanceOf(MysqlQueryCompiler);
});

test('createAdapter builds a MysqlAdapter', () => {
  expect(MYSQL_KYSELY_PARTS.createAdapter()).toBeInstanceOf(MysqlAdapter);
});

test('createIntrospector builds a MysqlIntrospector bound to the db', () => {
  const db = {} as unknown as Kysely<unknown>;
  expect(MYSQL_KYSELY_PARTS.createIntrospector(db)).toBeInstanceOf(MysqlIntrospector);
});
