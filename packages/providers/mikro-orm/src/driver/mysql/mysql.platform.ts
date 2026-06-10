import { MySqlPlatform } from '@mikro-orm/mysql';

import { withBunMySqlFixes } from '../shared';

/**
 * MySQL platform for the Bun.SQL backend. Two corrections vs the official `@mikro-orm/mysql` driver:
 *
 * 1. **`datetime`** (no tz) — shared with MariaDB via {@link withBunMySqlFixes} (remap to
 *    `BunUtcDateTimeType`; Bun.SQL parses the wall-clock in the host process timezone).
 * 2. **JSON** — official {@link MySqlPlatform} inherits `convertsJsonAutomatically() === true`
 *    (correct for `mysql2`, which parses JSON before MikroORM sees it). Bun.SQL returns JSON as a raw
 *    string, so we return `false` to make MikroORM's {@link JsonType} run its own `JSON.parse`.
 *    This override is MySQL-only — official `MariaDbPlatform` already returns `false`.
 */
export class BunMySqlPlatform extends withBunMySqlFixes(MySqlPlatform) {
  override convertsJsonAutomatically(): boolean {
    return false;
  }
}
