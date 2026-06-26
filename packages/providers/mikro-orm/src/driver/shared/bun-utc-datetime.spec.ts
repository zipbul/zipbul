// Forced non-UTC zone (bun:test pins TZ=UTC, which would make the reinterpretation a no-op and hide
// regressions). Must precede any Date construction.
process.env.TZ = 'Asia/Seoul';

import { test, expect, describe } from 'bun:test';

import { BunUtcDateTimeType } from './bun-utc-datetime';

// No-DB unit coverage for the flagship C5 type-fidelity fix: Bun.SQL hands a Date built from the
// stored wall-clock parsed in the PROCESS timezone; this type reinterprets those local calendar
// fields as UTC, recovering the exact instant the official driver returns.
describe('BunUtcDateTimeType.convertToJSValue', () => {
  const type = new BunUtcDateTimeType();

  test('reinterprets a process-local Date wall-clock as the same UTC wall-clock', () => {
    // What Bun.SQL produces for the stored value "2026-05-30 08:00:00" on a KST box: a Date whose
    // LOCAL fields read 2026-05-30 08:00:00 (its absolute instant is 2026-05-29T23:00:00Z).
    const fromBun = new Date(2026, 4, 30, 8, 0, 0, 0);
    const out = type.convertToJSValue(fromBun as unknown as string);
    expect(out.toISOString()).toBe('2026-05-30T08:00:00.000Z');
  });

  test('is a no-op for an already-UTC wall-clock when the local fields equal the UTC fields', () => {
    // midnight is identical in any zone offset by whole hours only for the date part; use an instant
    // whose KST local fields we compute explicitly.
    const fromBun = new Date(2026, 0, 1, 12, 34, 56, 789);
    const out = type.convertToJSValue(fromBun as unknown as string);
    expect(out.toISOString()).toBe('2026-01-01T12:34:56.789Z');
  });

  test('passes a non-Date value through unchanged (defensive against null/string inputs)', () => {
    expect(type.convertToJSValue('not-a-date' as unknown as string)).toBe('not-a-date' as unknown as Date);
  });
});
