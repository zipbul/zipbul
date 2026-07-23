import { describe, expect, it } from 'bun:test';

import { defineMiddleware } from '@zipbul/common';
import { HttpAdapter, HttpContext, HttpHeader } from '@zipbul/http-adapter';

import { runHelmet } from './helpers';

/**
 * helmet runs at `OnRequest` — before the handler. These 4 operations pin the
 * general ordering contract with one representative header (Referrer-Policy):
 * a middleware placed before helmet has its write overwritten (helmet's own
 * `setHeader` always replaces); a middleware placed after helmet always wins,
 * because it writes later — a public ordering contract helmet cannot block,
 * not a helmet defect. Per-header repetition of these operations lives in each
 * `<feature>.test.ts`.
 */
describe('helmetMiddleware — ordering (public write-order contract)', () => {
  it('prior setHeader is overwritten — helmet writes after and replaces', async () => {
    const prior = defineMiddleware([HttpAdapter], () => (ctx) => {
      ctx.to(HttpContext).response.setHeader(HttpHeader.ReferrerPolicy, 'origin');
    });
    const ctx = await runHelmet(undefined, { prior: [prior] });
    expect(ctx.response.headers.get(HttpHeader.ReferrerPolicy)).toBe('no-referrer');
  });

  it('prior appendHeader is overwritten — setHeader replaces every prior value', async () => {
    const prior = defineMiddleware([HttpAdapter], () => (ctx) => {
      ctx.to(HttpContext).response.appendHeader(HttpHeader.ReferrerPolicy, 'origin');
    });
    const ctx = await runHelmet(undefined, { prior: [prior] });
    expect(ctx.response.headers.get(HttpHeader.ReferrerPolicy)).toBe('no-referrer');
  });

  it('subsequent setHeader wins — a later replacing write beats helmet', async () => {
    const subsequent = defineMiddleware([HttpAdapter], () => (ctx) => {
      ctx.to(HttpContext).response.setHeader(HttpHeader.ReferrerPolicy, 'unsafe-url');
    });
    const ctx = await runHelmet(undefined, { subsequent: [subsequent] });
    expect(ctx.response.headers.get(HttpHeader.ReferrerPolicy)).toBe('unsafe-url');
  });

  // STANDARDS §2.4: last-wins. appendHeader does not replace helmet's value —
  // it adds a second value, so the *wire* value carries both. But per §2.4
  // the last recognized token in that comma list is the effective policy,
  // so the subsequent middleware's token still wins in effect.
  it('subsequent appendHeader wins in effect — last recognized token governs', async () => {
    const subsequent = defineMiddleware([HttpAdapter], () => (ctx) => {
      ctx.to(HttpContext).response.appendHeader(HttpHeader.ReferrerPolicy, 'unsafe-url');
    });
    const ctx = await runHelmet(undefined, { subsequent: [subsequent] });
    expect(ctx.response.headers.get(HttpHeader.ReferrerPolicy)).toBe('no-referrer, unsafe-url');
  });
});
