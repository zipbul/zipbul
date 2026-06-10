import { MariaDbPlatform } from '@mikro-orm/mariadb';

import { withBunMySqlFixes } from '../shared';

/**
 * MariaDB platform for the Bun.SQL backend. Extends the official {@link MariaDbPlatform} — which
 * carries MariaDB's own `MariaDbSchemaHelper` and JSON handling, and inherits the rest from
 * `MySqlPlatform` — and layers the no-tz `datetime` UTC remap shared by the MySQL family via
 * {@link withBunMySqlFixes}.
 *
 * Unlike {@link BunMySqlPlatform}, there is no JSON override here: official `MariaDbPlatform` already
 * returns `convertsJsonAutomatically() === false` with a hydration-aware `convertJsonToDatabaseValue`,
 * which is exactly what Bun.SQL (raw-string JSON) needs.
 */
export class BunMariaDbPlatform extends withBunMySqlFixes(MariaDbPlatform) {}
