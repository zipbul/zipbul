import {
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type Kysely,
} from 'kysely';

import type { KyselyDialectParts } from '../../dialect';

/**
 * The PostgreSQL Kysely trio (adapter / query-compiler / introspector) plugged into
 * {@link BunSqlDialect}. This is the per-DB variation point for Postgres.
 *
 * @internal
 */
export const POSTGRES_KYSELY_PARTS: KyselyDialectParts = {
  createQueryCompiler: () => new PostgresQueryCompiler(),
  createAdapter: () => new PostgresAdapter(),
  createIntrospector: (db: Kysely<unknown>) => new PostgresIntrospector(db),
};
