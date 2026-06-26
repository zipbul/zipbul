import { MySqlPlatform } from '@mikro-orm/mysql';

import { withBunMySqlTypeFixes } from '../shared';

/**
 * MySQL platform for the Bun.SQL backend. Two corrections vs the official `@mikro-orm/mysql` driver:
 *
 * 1. **`datetime`/`timestamp`/`date`/`year`** — shared with MariaDB via {@link withBunMySqlTypeFixes}
 *    (no-tz datetime/timestamp → `BunUtcDateTimeType`; `date` → 'YYYY-MM-DD' string; `year` → number).
 * 2. **JSON** — official {@link MySqlPlatform} inherits `convertsJsonAutomatically() === true`
 *    (correct for `mysql2`, which parses JSON before MikroORM sees it). Bun.SQL returns JSON as a raw
 *    string, so we return `false` to make MikroORM's {@link JsonType} run its own `JSON.parse`.
 *    This override is MySQL-only — official `MariaDbPlatform` already returns `false`.
 */
// Named, explicitly-typed mixin base so the `extends` clause is a plain identifier — required by
// `isolatedDeclarations` (TS9021: a heritage clause may not contain a call expression). The mixin
// overrides `getMappedType` and `convertDateToJSValue` (both base signatures), so its public type is
// exactly `typeof MySqlPlatform`.
const BunMySqlPlatformBase: typeof MySqlPlatform = withBunMySqlTypeFixes(MySqlPlatform);

export class BunMySqlPlatform extends BunMySqlPlatformBase {
  override convertsJsonAutomatically(): boolean {
    return false;
  }
}
