import { Type } from '@mikro-orm/core';
import type { AbstractSqlPlatform } from '@mikro-orm/sql';

import { BunUtcDateTimeType } from './bun-utc-datetime.type';

/** Abstract constructor bound, as required by the TS mixin pattern (single `any[]` rest param). */
// oxlint-disable-next-line no-explicit-any
type AbstractPlatformCtor<T extends AbstractSqlPlatform> = abstract new (...args: any[]) => T;

/**
 * Mixin applying the Bun.SQL coercion fix shared by the MySQL **family** (MySQL + MariaDB).
 *
 * The only genuinely shared fix is the no-tz `datetime` remap: Bun.SQL parses the wall-clock text
 * in the host process timezone, shifting the instant off-UTC, so `datetime` columns are mapped to
 * {@link BunUtcDateTimeType} (a no-op under a UTC process). See that type for the full rationale.
 *
 * Why a mixin and not inheritance: the official hierarchy is `MariaDbPlatform extends MySqlPlatform`,
 * and our `BunMySqlPlatform` also extends `MySqlPlatform`. Making `BunMariaDbPlatform` a child of
 * `BunMySqlPlatform` would drop MariaDB's own SchemaHelper/QueryBuilder/JSON specialization. So both
 * `BunMySqlPlatform = withBunMySqlFixes(MySqlPlatform)` and
 * `BunMariaDbPlatform = withBunMySqlFixes(MariaDbPlatform)` keep their official parent and share this
 * one fix here — zero duplication, official equivalence preserved.
 *
 * JSON auto-parsing is intentionally NOT handled here: official `MariaDbPlatform` already returns
 * `convertsJsonAutomatically() === false`, so it would be a no-op for MariaDB. Only `MySqlPlatform`
 * inherits `true`, so that override lives in {@link BunMySqlPlatform} alone.
 */
// Return type is annotated as the named `TBase` (not the anonymous mixin subclass): declaration
// emit (`.d.ts`) cannot express an anonymous class that inherits protected members from
// AbstractSqlPlatform (TS4094). The returned class is the real subclass at runtime — the override
// keeps the same `getMappedType` signature as the base, so collapsing the static type to `TBase`
// loses nothing for consumers.
export function withBunMySqlFixes<TBase extends AbstractPlatformCtor<AbstractSqlPlatform>>(Base: TBase): TBase {
  abstract class BunMySqlFixedPlatform extends Base {
    override getMappedType(type: string): Type<unknown> {
      if (this.extractSimpleType(type) === 'datetime') {
        return Type.getType(BunUtcDateTimeType);
      }
      return super.getMappedType(type);
    }
  }

  return BunMySqlFixedPlatform as unknown as TBase;
}
