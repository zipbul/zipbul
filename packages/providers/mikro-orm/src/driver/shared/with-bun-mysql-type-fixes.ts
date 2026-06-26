import { Type } from '@mikro-orm/core';
import type { AbstractSqlPlatform } from '@mikro-orm/sql';

import { bunDateToYmd } from './bun-date';
import { BunUtcDateTimeType } from './bun-utc-datetime';
import { BunYearType } from './bun-year.type';
import type { AbstractPlatformCtor } from './types';

/**
 * Mixin applying the Bun.SQL type-fidelity corrections shared by the MySQL **family** (MySQL +
 * MariaDB), where Bun.SQL's protocol-level coercion diverges from the official mysql2 driver:
 *
 *  - **`datetime` / `timestamp`** (no tz) — Bun.SQL parses the wall-clock text in the host process
 *    timezone, shifting the instant off-UTC, so both are remapped to {@link BunUtcDateTimeType} (a
 *    no-op under a UTC process), which reinterprets the value as UTC. MySQL stores `timestamp` and
 *    `datetime` identically as wall-clock text and Bun.SQL reads both the same way.
 *  - **`date`** — Bun.SQL returns a `Date` object; the official `DateType` yields a 'YYYY-MM-DD'
 *    string. {@link convertDateToJSValue} restores the string via {@link bunDateToYmd} (the same hook
 *    {@link import('../postgres/postgres.platform').BunPostgreSqlPlatform} uses).
 *  - **`year`** — Bun.SQL returns the column as a string; the official driver yields a number. Remapped
 *    to {@link BunYearType}, which coerces the hydrated string to a number.
 *
 * Why a mixin and not inheritance: the official hierarchy is `MariaDbPlatform extends MySqlPlatform`,
 * and our `BunMySqlPlatform` also extends `MySqlPlatform`. Making `BunMariaDbPlatform` a child of
 * `BunMySqlPlatform` would drop MariaDB's own SchemaHelper/QueryBuilder/JSON specialization. So both
 * `BunMySqlPlatform` and `BunMariaDbPlatform` keep their official parent and share these corrections
 * here — zero duplication, official equivalence preserved.
 *
 * JSON auto-parsing is intentionally NOT handled here: official `MariaDbPlatform` already returns
 * `convertsJsonAutomatically() === false`, so it would be a no-op for MariaDB. Only `MySqlPlatform`
 * inherits `true`, so that override lives in {@link import('../mysql/mysql.platform').BunMySqlPlatform}
 * alone.
 */
// Return type is annotated as the named `TBase` (not the anonymous mixin subclass): declaration emit
// (`.d.ts`) cannot express an anonymous class that inherits protected members from AbstractSqlPlatform
// (TS4094). The returned class is the real subclass at runtime — the overrides keep their base
// signatures, so collapsing the static type to `TBase` loses nothing for consumers.
export function withBunMySqlTypeFixes<TBase extends AbstractPlatformCtor<AbstractSqlPlatform>>(Base: TBase): TBase {
  abstract class BunMySqlTypeFixesPlatform extends Base {
    override getMappedType(type: string): Type<unknown> {
      const simpleType = this.extractSimpleType(type);
      if (simpleType === 'datetime' || simpleType === 'timestamp') {
        return Type.getType(BunUtcDateTimeType);
      }
      if (simpleType === 'year') {
        return Type.getType(BunYearType);
      }
      return super.getMappedType(type);
    }

    override convertDateToJSValue(value: string | Date): string {
      return bunDateToYmd(value);
    }
  }

  return BunMySqlTypeFixesPlatform as unknown as TBase;
}
