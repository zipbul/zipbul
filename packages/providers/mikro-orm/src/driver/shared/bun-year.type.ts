import { Type } from '@mikro-orm/core';

/**
 * MySQL/MariaDB `YEAR` column type for the Bun.SQL backend. Bun.SQL returns a YEAR column as a
 * string (e.g. "2026", and "0000" for year zero); the official mysql2 driver yields a number. This
 * coerces the hydrated value back to a number to match. null/undefined is left untouched —
 * `Number(null)` would wrongly yield 0.
 */
export class BunYearType extends Type<number | null | undefined, number | string | null | undefined> {
  override convertToJSValue(value: number | string | null | undefined): number | null | undefined {
    return value == null ? value : Number(value);
  }

  override getColumnType(): string {
    return 'year';
  }
}
