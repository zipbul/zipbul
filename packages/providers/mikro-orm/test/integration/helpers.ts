import { describe } from 'bun:test';
import { MikroORM, type Options } from '@mikro-orm/core';
import { SqlSchemaGenerator } from '@mikro-orm/sql';

import { BunPostgreSqlDriver, BunMySqlDriver } from '../../src/driver';

/**
 * docker-backed lanes skip cleanly when the connection string env is absent, so a
 * docker-less `bun test` (the default unit lane) stays green. Run with:
 *   DB_URL_PG=postgres://poc:poc@127.0.0.1:55401/pocdb \
 *   DB_URL_MYSQL=mysql://poc:poc@127.0.0.1:33401/pocdb bun test
 *
 * IMPORTANT: each test FILE must define its OWN entity classes with unique names. Sharing
 * one entity class across multiple `MikroORM.init` calls in a single `bun test` process
 * hangs MikroORM's global metadata processing — so there is no shared entity here.
 */
export const PG_URL = process.env.DB_URL_PG;
export const MYSQL_URL = process.env.DB_URL_MYSQL;
export const describePg = PG_URL ? describe : describe.skip;
export const describeMysql = MYSQL_URL ? describe : describe.skip;

/** Schema generator surface via the `orm.schema` getter (wired by the SqlSchemaGenerator extension). */
type SchemaGen = { drop(o?: { dropForeignKeys?: boolean }): Promise<void>; create(): Promise<void> };
const schemaGen = (orm: MikroORM): SchemaGen => (orm as unknown as { schema: SchemaGen }).schema;

export async function makeOrm(
  driver: typeof BunPostgreSqlDriver | typeof BunMySqlDriver,
  clientUrl: string,
  entities: Options['entities'],
): Promise<MikroORM> {
  return MikroORM.init({
    driver,
    clientUrl,
    entities,
    extensions: [SqlSchemaGenerator],
  } as unknown as Options);
}

export async function freshSchema(orm: MikroORM): Promise<void> {
  await schemaGen(orm).drop({ dropForeignKeys: true });
  await schemaGen(orm).create();
}
