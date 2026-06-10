import {
  MysqlAdapter,
  MysqlIntrospector,
  MysqlQueryCompiler,
  type Kysely,
} from 'kysely';

import type { KyselyDialectParts } from '../../bun-sql';

/**
 * The MySQL Kysely trio plugged into {@link BunSqlDialect}.
 *
 * @internal
 */
export const MYSQL_KYSELY_PARTS: KyselyDialectParts = {
  createQueryCompiler: () => new MysqlQueryCompiler(),
  createAdapter: () => new MysqlAdapter(),
  createIntrospector: (db: Kysely<unknown>) => new MysqlIntrospector(db),
};
