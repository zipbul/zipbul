// Nested transactions use SAVEPOINTs. The savepoint identifier must be quoted per dialect:
// MySQL/MariaDB require backticks (a double-quoted token is a string literal under the default
// sql_mode → ER_PARSE_ERROR), Postgres uses double quotes. Regression for the substrate bug where
// all dialects were double-quoted, silently breaking every MySQL/MariaDB nested transaction.
import { test, expect, beforeAll, afterAll, beforeEach, describe } from 'bun:test';
import { MikroORM, type Options } from '@mikro-orm/core';
import { SqlSchemaGenerator } from '@mikro-orm/sql';

import { Entity, PrimaryKey, Property } from '../../src/entity';
import { BunPostgreSqlDriver, BunMySqlDriver, BunMariaDbDriver } from '../../src/driver';
import { PG_URL, MYSQL_URL, MARIADB_URL, describePg, describeMysql, describeMariadb } from './helpers';

@Entity()
class NtRow {
  @PrimaryKey({ type: 'number', autoincrement: true }) id!: number;
  @Property({ type: 'string' }) v!: string;
}

function nestedTxnSuite(label: string, gate: typeof describe, driver: NonNullable<Options['driver']>, url: string | undefined): void {
  gate(`nested transactions (${label})`, () => {
    let orm: MikroORM;
    beforeAll(async () => {
      orm = await MikroORM.init({ driver, clientUrl: url, entities: [NtRow], extensions: [SqlSchemaGenerator] } as unknown as Options);
    });
    afterAll(async () => {
      await orm.close(true);
    });
    beforeEach(async () => {
      const s = orm as unknown as { schema: { drop(o?: { dropForeignKeys?: boolean }): Promise<void>; create(): Promise<void> } };
      await s.schema.drop({ dropForeignKeys: true });
      await s.schema.create();
    });

    test('a nested transaction commits its savepoint with the outer transaction', async () => {
      await orm.em.fork().transactional(async (em) => {
        em.persist(em.create(NtRow, { v: 'outer' }));
        await em.flush();
        await em.transactional(async (inner) => {
          inner.persist(inner.create(NtRow, { v: 'inner' }));
          await inner.flush();
        });
      });
      expect(await orm.em.fork().count(NtRow, {})).toBe(2);
    });

    test('a thrown nested transaction rolls back to the savepoint, outer survives', async () => {
      await orm.em.fork().transactional(async (em) => {
        em.persist(em.create(NtRow, { v: 'keep' }));
        await em.flush();
        await expect(
          em.transactional(async (inner) => {
            inner.persist(inner.create(NtRow, { v: 'discard' }));
            await inner.flush();
            throw new Error('inner boom');
          }),
        ).rejects.toThrow('inner boom');
      });
      const rows = await orm.em.fork().find(NtRow, {});
      expect(rows.map((r) => r.v)).toEqual(['keep']);
    });
  });
}

nestedTxnSuite('postgres', describePg, BunPostgreSqlDriver, PG_URL);
nestedTxnSuite('mysql', describeMysql, BunMySqlDriver, MYSQL_URL);
nestedTxnSuite('mariadb', describeMariadb, BunMariaDbDriver, MARIADB_URL);

// MySQL/MariaDB only: DDL inside a transaction triggers an implicit COMMIT (no transactional DDL),
// which silently drops the open savepoint. Committing the nested transaction then issues
// `RELEASE SAVEPOINT` on a vanished savepoint → errno 1305. The official MySqlConnection swallows
// exactly 1305 (knex#805); BunMySqlConnection must match (else the nested commit throws).
function ddlDropsSavepointSuite(label: string, gate: typeof describe, driver: NonNullable<Options['driver']>, url: string | undefined): void {
  gate(`nested commit after DDL drops the savepoint (${label})`, () => {
    let orm: MikroORM;
    beforeAll(async () => {
      orm = await MikroORM.init({ driver, clientUrl: url, entities: [NtRow], extensions: [SqlSchemaGenerator] } as unknown as Options);
    });
    afterAll(async () => {
      await orm.em.getConnection().execute('drop table if exists nt_ddl_marker').catch(() => undefined);
      await orm.close(true);
    });

    test('committing the nested tx does not throw when DDL dropped its savepoint (errno 1305 swallowed)', async () => {
      await orm.em.getConnection().execute('drop table if exists nt_ddl_marker');
      await expect(
        orm.em.fork().transactional(async (em) => {
          await em.transactional(async (inner) => {
            // DDL → implicit COMMIT → the inner savepoint vanishes. Run it on the inner tx connection.
            await inner.getConnection().execute('create table nt_ddl_marker (a int)', [], 'run', inner.getTransactionContext());
          });
          // leaving the inner block issues RELEASE SAVEPOINT on the vanished savepoint
        }),
      ).resolves.toBeUndefined();
    });
  });
}

ddlDropsSavepointSuite('mysql', describeMysql, BunMySqlDriver, MYSQL_URL);
ddlDropsSavepointSuite('mariadb', describeMariadb, BunMariaDbDriver, MARIADB_URL);
