import type { Configuration } from '@mikro-orm/core';
import { MariaDbDriver } from '@mikro-orm/mariadb';

import { BunMySqlDriver } from '../mysql';
import { BunMariaDbPlatform } from './mariadb.platform';

/**
 * MikroORM MariaDB driver on Bun's native Bun.SQL. Mirrors the official `MariaDbDriver` (which
 * extends `MySqlDriver`) by extending our {@link BunMySqlDriver}, inheriting:
 *  - the Bun.SQL connection (`BunMySqlConnection` — MariaDB speaks the MySQL wire protocol),
 *  - the mysql Kysely parts + error-normalizer (MariaDB surfaces the same native errnos, incl. 4025),
 *  - the no-RETURNING batch-insert PK back-fill. `Platform.usesReturningStatement()` is `false` for
 *    the whole MySQL family (MariaDB included), so MikroORM recovers PKs from
 *    `insertId + idx * auto_increment_increment` exactly as for MySQL — official `MariaDbDriver`
 *    likewise does NOT override `nativeInsertMany/nativeUpdateMany`.
 *
 * MariaDB-specific deltas, matching official:
 *  1. `platform` -> {@link BunMariaDbPlatform} (MariaDB SchemaHelper/JSON + the Bun.SQL datetime fix).
 *  2. `createQueryBuilder` -> the official `MariaDbQueryBuilder`, whose `wrapPaginateSubQuery` uses
 *     `json_arrayagg`/`json_contains` to work around MariaDB's inability to use `LIMIT` inside
 *     `WHERE IN (subquery)`. That class is intentionally not exported by `@mikro-orm/mariadb` (its
 *     `exports` map only exposes `.`), so we reuse the official `createQueryBuilder` method itself —
 *     a closure over `MariaDbQueryBuilder` — instead of re-implementing the SQL generation, which
 *     would silently drift from upstream.
 */
export class BunMariaDbDriver extends BunMySqlDriver {
  constructor(config: Configuration) {
    super(config);
    // `platform` is declared readonly on the base, but the official MariaDbDriver likewise
    // reassigns it in its constructor — mirror that via an explicit cast.
    (this as unknown as { platform: BunMariaDbPlatform }).platform = new BunMariaDbPlatform();
    this.createQueryBuilder =
      MariaDbDriver.prototype.createQueryBuilder as unknown as BunMySqlDriver['createQueryBuilder'];
  }
}
