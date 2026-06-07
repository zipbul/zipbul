import { MySqlPlatform } from '@mikro-orm/mysql';
import { Type } from '@mikro-orm/core';

import { BunUtcDateTimeType } from '../bun-utc-datetime.type';

/**
 * MySQL/MariaDB platform for the Bun.SQL backend. Corrects two Bun.SQL coercion divergences from
 * the official `@mikro-orm/mysql` driver:
 *
 * 1. **JSON** — The official {@link MySqlPlatform} inherits `convertsJsonAutomatically() === true`,
 *    correct for `mysql2` (which parses JSON columns into objects before MikroORM sees them). Bun.SQL
 *    does NOT auto-parse JSON — it returns the raw string (verified on MySQL 9.7 + MariaDB 11). When
 *    the platform claims auto-parsing, MikroORM's {@link JsonType} trusts the driver and skips its
 *    own `JSON.parse`. Returning `false` makes MikroORM parse it (`convertJsonToJSValue`).
 * 2. **`datetime`** (no tz) — Bun.SQL parses the wall-clock in the host process timezone, shifting
 *    the instant off-UTC (verified: a UTC instant read back 9h earlier on a KST box). We map it to
 *    {@link BunUtcDateTimeType}, which reinterprets the value as UTC (a no-op under a UTC process).
 */
export class BunMySqlPlatform extends MySqlPlatform {
  override convertsJsonAutomatically(): boolean {
    return false;
  }

  override getMappedType(type: string): Type<unknown> {
    if (this.extractSimpleType(type) === 'datetime') {
      return Type.getType(BunUtcDateTimeType);
    }
    return super.getMappedType(type);
  }
}
