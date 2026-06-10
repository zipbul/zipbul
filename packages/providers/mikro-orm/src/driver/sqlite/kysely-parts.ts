import {
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type Kysely,
} from 'kysely';

import type { KyselyDialectParts } from '../../bun-sql';

/**
 * The SQLite Kysely trio plugged into the SQLite dialect.
 *
 * @internal
 */
export const SQLITE_KYSELY_PARTS: KyselyDialectParts = {
  createQueryCompiler: () => new SqliteQueryCompiler(),
  createAdapter: () => new SqliteAdapter(),
  createIntrospector: (db: Kysely<unknown>) => new SqliteIntrospector(db),
};
