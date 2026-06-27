import { MariaDbPlatform } from '@mikro-orm/mariadb';

import { withBunMySqlTypeFixes } from '../shared';

/**
 * MariaDB platform for the Bun.SQL backend. Extends the official {@link MariaDbPlatform} — which
 * carries MariaDB's own `MariaDbSchemaHelper` and JSON handling, and inherits the rest from
 * `MySqlPlatform` — and layers the Bun.SQL type-fidelity fixes shared by the MySQL family
 * (no-tz `datetime`/`timestamp` UTC remap, `date` → string, `year` → number) via
 * {@link withBunMySqlTypeFixes}.
 *
 * Unlike {@link BunMySqlPlatform}, there is no JSON override here: official `MariaDbPlatform` already
 * returns `convertsJsonAutomatically() === false` with a hydration-aware `convertJsonToDatabaseValue`,
 * which is exactly what Bun.SQL (raw-string JSON) needs.
 */
// Named, explicitly-typed mixin base so the `extends` clause is a plain identifier (isolatedDeclarations
// TS9021). The mixin overrides `getMappedType`/`convertDateToJSValue`, so the public type is exactly
// `typeof MariaDbPlatform`.
const BunMariaDbPlatformBase: typeof MariaDbPlatform = withBunMySqlTypeFixes(MariaDbPlatform);

export class BunMariaDbPlatform extends BunMariaDbPlatformBase {}
