import { PostgreSqlPlatform } from '@mikro-orm/postgresql';
import { Type } from '@mikro-orm/core';

import { BunUtcDateTimeType } from '../shared';

/**
 * PostgreSQL platform for the Bun.SQL backend. Corrects two places where Bun.SQL's protocol-level
 * type coercion diverges from the official `@mikro-orm/postgresql` driver (which keeps date/time
 * OIDs as raw strings via `createPostgreSqlTypeParsers` and lets MikroORM parse them):
 *
 * 1. **`date`** — Bun.SQL returns a `Date` object; the official `DateType` yields a `YYYY-MM-DD`
 *    string. We restore the string in {@link convertDateToJSValue} (UTC fields, since a `date` is
 *    parsed as UTC midnight).
 * 2. **`timestamp`** (no tz) — Bun.SQL parses the wall-clock in the host process timezone, shifting
 *    the instant off-UTC. We map it to {@link BunUtcDateTimeType}, which reinterprets the value as
 *    UTC. `timestamptz` is unaffected (Bun.SQL returns a correct absolute instant) and keeps the
 *    stock type.
 */
export class BunPostgreSqlPlatform extends PostgreSqlPlatform {
  override getMappedType(type: string): Type<unknown> {
    const simple = this.extractSimpleType(type);
    // No-tz timestamp in BOTH spellings: the short `timestamp` and the canonical
    // `timestamp without time zone` that introspection / EntityGenerator emit. `timestamptz`
    // and `timestamp with time zone` are returned as a correct absolute instant by Bun.SQL and
    // are intentionally excluded.
    if (simple === 'timestamp' || simple === 'timestamp without time zone') {
      return Type.getType(BunUtcDateTimeType);
    }
    return super.getMappedType(type);
  }

  override convertDateToJSValue(value: string | Date): string {
    if (value instanceof Date) {
      const y = value.getUTCFullYear().toString().padStart(4, '0');
      const m = (value.getUTCMonth() + 1).toString().padStart(2, '0');
      const d = value.getUTCDate().toString().padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return value;
  }
}
