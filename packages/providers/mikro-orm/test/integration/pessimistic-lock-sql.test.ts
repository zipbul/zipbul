// A pessimistic write lock must actually emit `... FOR UPDATE` — asserting only that the row loads
// is fake-green (a plain SELECT satisfies it). Capture the SQL via the MikroORM logger and assert
// the lock clause is present, across every dialect that supports row locks (sqlite serializes via
// file lock and has no FOR UPDATE, so it is excluded).
import { test, expect, beforeAll, afterAll, beforeEach, describe } from 'bun:test';
import { MikroORM, LockMode, type Options } from '@mikro-orm/core';
import { SqlSchemaGenerator } from '@mikro-orm/sql';

import { Entity, PrimaryKey, Property } from '../../src/entity';
import { BunPostgreSqlDriver, BunMySqlDriver, BunMariaDbDriver } from '../../src/driver';
import { PG_URL, MYSQL_URL, MARIADB_URL, describePg, describeMysql, describeMariadb } from './helpers';

@Entity()
class PlRow {
  @PrimaryKey({ type: 'number', autoincrement: true }) id!: number;
  @Property({ type: 'number' }) value!: number;
}

function pessimisticSuite(label: string, gate: typeof describe, driver: NonNullable<Options['driver']>, url: string | undefined): void {
  gate(`pessimistic write lock emits FOR UPDATE (${label})`, () => {
    let orm: MikroORM;
    const logs: string[] = [];
    beforeAll(async () => {
      orm = await MikroORM.init({
        driver, clientUrl: url, entities: [PlRow], extensions: [SqlSchemaGenerator],
        debug: true, logger: (m: string) => logs.push(m),
      } as unknown as Options);
    });
    afterAll(async () => {
      await orm.close(true);
    });
    beforeEach(async () => {
      const s = orm as unknown as { schema: { drop(o?: { dropForeignKeys?: boolean }): Promise<void>; create(): Promise<void> } };
      await s.schema.drop({ dropForeignKeys: true });
      await s.schema.create();
      const seed = orm.em.fork();
      seed.persist(seed.create(PlRow, { value: 1 }));
      await seed.flush();
      logs.length = 0;
    });

    test('PESSIMISTIC_WRITE issues SELECT ... FOR UPDATE inside a transaction', async () => {
      await orm.em.fork().transactional(async (em) => {
        const row = await em.findOneOrFail(PlRow, { value: 1 }, { lockMode: LockMode.PESSIMISTIC_WRITE });
        expect(row.value).toBe(1);
      });
      expect(logs.join('\n').toLowerCase()).toContain('for update');
    });
  });
}

pessimisticSuite('postgres', describePg, BunPostgreSqlDriver, PG_URL);
pessimisticSuite('mysql', describeMysql, BunMySqlDriver, MYSQL_URL);
pessimisticSuite('mariadb', describeMariadb, BunMariaDbDriver, MARIADB_URL);
