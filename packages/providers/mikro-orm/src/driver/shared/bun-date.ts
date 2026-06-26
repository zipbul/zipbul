/**
 * Formats a Bun.SQL `date` column value as the 'YYYY-MM-DD' string the official MikroORM `DateType`
 * contract expects. Bun.SQL's text protocol (`.unsafe`) returns a `date` as a `Date` at TZ-invariant
 * UTC midnight — verified on Postgres, MySQL, and MariaDB across host timezones (Asia/Seoul,
 * America/New_York, UTC) — so the UTC fields recover the stored wall-date regardless of process TZ.
 * A non-Date value (null/undefined, or an already-formatted string) passes through unchanged.
 */
export function bunDateToYmd(value: string | Date): string {
  if (value instanceof Date) {
    const y = value.getUTCFullYear().toString().padStart(4, '0');
    const m = (value.getUTCMonth() + 1).toString().padStart(2, '0');
    const d = value.getUTCDate().toString().padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return value;
}
