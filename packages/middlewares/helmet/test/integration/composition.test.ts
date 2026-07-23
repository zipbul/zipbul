import { describe, expect, it } from 'bun:test';

import { defineMiddleware } from '@zipbul/common';
import { isErr } from '@zipbul/result';
import { HttpAdapter, HttpContext, HttpHeader } from '@zipbul/http-adapter';

import type { HelmetOptions } from '../../index';
import { resolveHelmetOptions } from '../../src/options';

import { runHelmet } from './helpers';

/**
 * The option keys covered by the n+2 composition matrix, derived from
 * `resolveHelmetOptions({})` rather than hand-listed — adding a field to
 * `HelmetOptions` grows `n` here automatically (the key-list itself is kept
 * honest by `definition.test.ts`'s drift guard).
 */
function optionKeys(): ReadonlyArray<keyof HelmetOptions> {
  const resolved = resolveHelmetOptions({});
  if (isErr(resolved)) {
    throw new Error('expected ok, got err');
  }
  return Object.keys(resolved) as Array<keyof HelmetOptions>;
}

const OPTION_KEYS = optionKeys();

/**
 * Expected wire entry per header when every header is on (secure defaults).
 * Hand-maintained — a new header's expected on-value is added here.
 */
const EXPECTED_ON: Record<keyof HelmetOptions, readonly [name: string, value: string]> = {
  xContentTypeOptions: [HttpHeader.XContentTypeOptions, 'nosniff'],
  referrerPolicy: [HttpHeader.ReferrerPolicy, 'no-referrer'],
};

/**
 * The exact set of header names helmet writes when a given set of options is on.
 * `mockContext` starts with an empty response (probed: `headers.keys() === []`)
 * and helmet is the only writer, so the response keyset must equal exactly this
 * — the plan §6 "정확히 일치 / 하나도 없음" contract. A per-header `.get()` loop
 * alone cannot catch helmet emitting an unexpected *extra* header; this can.
 */
function keysFor(onKeys: readonly (keyof HelmetOptions)[]): string[] {
  return onKeys.map((key) => EXPECTED_ON[key][0]).sort();
}
function actualKeys(ctx: Awaited<ReturnType<typeof runHelmet>>): string[] {
  return [...ctx.response.headers.keys()].sort();
}

describe('helmetMiddleware — composition (n+2)', () => {
  it('all on → exactly every header, each at its default value, nothing extra', async () => {
    const ctx = await runHelmet({});
    for (const key of OPTION_KEYS) {
      const [name, value] = EXPECTED_ON[key];
      expect(ctx.response.headers.get(name)).toBe(value);
    }
    expect(actualKeys(ctx)).toEqual(keysFor(OPTION_KEYS));
  });

  for (const offKey of OPTION_KEYS) {
    it(`single-off(${offKey}) → only that header is absent, the rest are unaffected`, async () => {
      const ctx = await runHelmet({ [offKey]: false } as Partial<HelmetOptions>);

      const [offName] = EXPECTED_ON[offKey];
      expect(ctx.response.headers.get(offName)).toBeNull();

      for (const otherKey of OPTION_KEYS) {
        if (otherKey === offKey) continue;
        const [name, value] = EXPECTED_ON[otherKey];
        expect(ctx.response.headers.get(name)).toBe(value);
      }
      expect(actualKeys(ctx)).toEqual(keysFor(OPTION_KEYS.filter((k) => k !== offKey)));
    });
  }

  it('all off → helmet emits no header at all', async () => {
    const allOff = Object.fromEntries(
      OPTION_KEYS.map((key) => [key, false]),
    ) as Partial<HelmetOptions>;
    const ctx = await runHelmet(allOff);

    expect(actualKeys(ctx)).toEqual([]);
  });

  it('prior middleware seeds every header with garbage, then all-on → every header is overwritten to a single default value', async () => {
    const priorGarbage = defineMiddleware([HttpAdapter], () => (ctx) => {
      const { response } = ctx.to(HttpContext);
      for (const key of OPTION_KEYS) {
        const [name] = EXPECTED_ON[key];
        response.setHeader(name, 'garbage');
        response.appendHeader(name, 'garbage-2');
      }
    });

    const ctx = await runHelmet({}, { prior: [priorGarbage] });
    for (const key of OPTION_KEYS) {
      const [name, value] = EXPECTED_ON[key];
      expect(ctx.response.headers.get(name)).toBe(value);
    }
  });
});
