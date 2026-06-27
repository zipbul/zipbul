import { DateTimeType } from '@mikro-orm/core';

/**
 * DateTime type for no-timezone columns (`timestamp` on PostgreSQL, `datetime` on MySQL/MariaDB)
 * read through Bun.SQL.
 *
 * The official drivers keep these columns as raw strings (via their pg/mysql type-parser overrides)
 * and let MikroORM's hydrator interpret them as UTC. Bun.SQL exposes no type-parser API, so it
 * eagerly builds a JS `Date` by parsing the wall-clock text in the HOST PROCESS timezone — e.g. the
 * stored `2026-05-30 10:20:30` becomes `01:20:30Z` on a KST box. That is silent value corruption
 * versus the official driver, and it surfaces only when the process timezone is not UTC.
 *
 * Fix: reinterpret the Date's LOCAL calendar fields (which, by construction, equal the original
 * stored wall-clock) as UTC. This recovers the exact instant the official driver returns, and is a
 * no-op when the process already runs in UTC (local fields == UTC fields), so it is correct in every
 * timezone. Only mapped for no-tz columns; `timestamptz` (which Bun.SQL parses to a correct absolute
 * instant) keeps the stock {@link DateTimeType}.
 */
export class BunUtcDateTimeType extends DateTimeType {
  // Bun.SQL hands us a `Date` at runtime even though the base contract types `value` as `string`.
  override convertToJSValue(value: string): Date {
    const v = value as unknown;
    if (!(v instanceof Date)) {
      return v as Date;
    }
    // NOTE: a year 0–99 is already collapsed to 1900–1999 by Bun.SQL's protocol parser BEFORE it
    // reaches us (it hands over a `Date`, not the raw string, and exposes no type-parser hook), so
    // ancient timestamps cannot be recovered here — a documented Bun.SQL ceiling, not fixable in this
    // type. For all in-range years this faithfully reinterprets the local wall-clock as UTC.
    return new Date(
      Date.UTC(
        v.getFullYear(),
        v.getMonth(),
        v.getDate(),
        v.getHours(),
        v.getMinutes(),
        v.getSeconds(),
        v.getMilliseconds(),
      ),
    );
  }
}
