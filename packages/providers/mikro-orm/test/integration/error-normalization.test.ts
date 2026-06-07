import { test, expect, beforeAll, afterAll, describe } from 'bun:test';
import {
  UniqueConstraintViolationException,
  NotNullConstraintViolationException,
  CheckConstraintViolationException,
  ForeignKeyConstraintViolationException,
  TableNotFoundException,
  MikroORM,
  type Options,
} from '@mikro-orm/core';
import { SqlSchemaGenerator } from '@mikro-orm/sql';

import { BunPostgreSqlDriver, BunMySqlDriver, BunSqliteDriver } from '../../src/driver';
import { PG_URL, MYSQL_URL, describePg, describeMysql, makeOrm } from './helpers';
import { Entity, PrimaryKey, Property } from '../../src/entity';

/** The converting execute lives on the SQL driver (`rethrow(connection.execute())`), not on the
 *  narrower `IDatabaseDriver` interface — structural type to reach it without an `any` cast. */
type ConvertingDriver = { execute(sql: string): Promise<unknown> };

// The driver-correctness bar (RED-PLAN §3): the per-DB error normalizer must hand the raw
// Bun.SQL error to MikroORM's official ExceptionConverter in the shape it expects, so EVERY
// constraint subtype becomes its typed MikroORM exception — not just the unique case.
//   - pg: Bun.SQL puts the SQLSTATE on `.errno` (23505/23502/23514/23503/42P01) and a generic
//         `ERR_POSTGRES_SERVER_ERROR` on `.code`; PostgresErrorNormalizer copies errno→code so
//         the converter (which switches on `.code`) fires. (verified live)
//   - mysql: Bun.SQL surfaces the native `.errno` (1062/1364/3819/1452/1146); the converter
//            switches on `.errno`, so the identity normalizer is correct. (verified live)
// The conversion happens in the DRIVER layer: `driver.execute()` is `rethrow(connection.execute())`,
// and `rethrow` runs convertException on failure (a bare `connection.execute()` does NOT convert).
// Driving the violations through `em.getDriver().execute()` therefore exercises the exact
// normalize→convert path that `em.flush()`/`nativeInsert` use, with one statement per subtype.

@Entity()
class EnAccount {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string', unique: true })
  email!: string;

  @Property({ type: 'string' })
  name!: string;
}

/** DDL for the constraint-violation fixtures. `int`/`primary key`/`references`/`check` are
 *  portable across pg and mysql (InnoDB default), so one set of statements serves both. */
const SETUP = [
  'drop table if exists en_child',
  'drop table if exists en_parent',
  'create table en_parent (id int primary key, v int not null unique, c int check (c > 0))',
  'create table en_child (id int primary key, pid int, foreign key (pid) references en_parent(id))',
  'insert into en_parent (id, v, c) values (1, 10, 5)',
];
const TEARDOWN = ['drop table if exists en_child', 'drop table if exists en_parent'];

/** Each case raises a DB constraint violation that the driver must map to the named exception. */
const CASES: Array<{ name: string; sql: string; expected: new (...a: never[]) => Error }> = [
  { name: 'UNIQUE → UniqueConstraintViolationException', sql: 'insert into en_parent (id, v, c) values (2, 10, 5)', expected: UniqueConstraintViolationException },
  { name: 'NOT NULL → NotNullConstraintViolationException', sql: 'insert into en_parent (id, c) values (3, 5)', expected: NotNullConstraintViolationException },
  { name: 'CHECK → CheckConstraintViolationException', sql: 'insert into en_parent (id, v, c) values (4, 99, -1)', expected: CheckConstraintViolationException },
  { name: 'FOREIGN KEY → ForeignKeyConstraintViolationException', sql: 'insert into en_child (id, pid) values (1, 999)', expected: ForeignKeyConstraintViolationException },
  { name: 'missing table → TableNotFoundException', sql: 'select * from en_nonexistent_table', expected: TableNotFoundException },
];

function exceptionParitySuite(label: string, gate: typeof describe, init: () => Promise<MikroORM>): void {
  gate(`error normalization (${label})`, () => {
    let orm: MikroORM;
    let drv: ConvertingDriver;
    beforeAll(async () => {
      orm = await init();
      drv = orm.em.getDriver() as unknown as ConvertingDriver;
      for (const stmt of SETUP) {
        await orm.em.getConnection().execute(stmt);
      }
    });
    afterAll(async () => {
      for (const stmt of TEARDOWN) {
        await orm.em.getConnection().execute(stmt).catch(() => undefined);
      }
      await orm.close(true);
    });

    for (const c of CASES) {
      test(c.name, async () => {
        await expect(drv.execute(c.sql)).rejects.toBeInstanceOf(c.expected);
      });
    }
  });
}

exceptionParitySuite('postgres', describePg, () => makeOrm(BunPostgreSqlDriver, PG_URL!, [EnAccount]));
exceptionParitySuite('mysql', describeMysql, () => makeOrm(BunMySqlDriver, MYSQL_URL!, [EnAccount]));
// SQLite runs in the default no-docker lane (`:memory:`), so the exception-mapping contract is
// always exercised even without a DB container. FK enforcement relies on BaseSqliteConnection's
// `pragma foreign_keys = on`.
exceptionParitySuite('sqlite', describe, () =>
  MikroORM.init({
    driver: BunSqliteDriver,
    dbName: ':memory:',
    entities: [EnAccount],
    extensions: [SqlSchemaGenerator],
  } as unknown as Options),
);
