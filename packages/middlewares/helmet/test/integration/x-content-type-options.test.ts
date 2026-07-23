import { describe, expect, it } from 'bun:test';

import { defineMiddleware } from '@zipbul/common';
import { HttpAdapter, HttpContext, HttpHeader } from '@zipbul/http-adapter';

import { runHelmet } from './helpers';

describe('helmetMiddleware — X-Content-Type-Options', () => {
  // STANDARDS §1.3: secure-by-default → header present with default config.
  // §1.2: the value is exactly `nosniff`.
  it('emits x-content-type-options: nosniff by default', async () => {
    const ctx = await runHelmet();
    expect(ctx.response.headers.get(HttpHeader.XContentTypeOptions)).toBe('nosniff');
  });

  // Emission is gated by the option.
  it('omits the header when xContentTypeOptions is false', async () => {
    const ctx = await runHelmet({ xContentTypeOptions: false });
    expect(ctx.response.headers.get(HttpHeader.XContentTypeOptions)).toBeNull();
  });

  // STANDARDS §1.5: setHeader replaces — a pre-existing header is overwritten,
  // never duplicated, so the UA's values[0] stays `nosniff`.
  it('overwrites a pre-existing value, leaving a single nosniff', async () => {
    const priorGarbage = defineMiddleware([HttpAdapter], () => (ctx) => {
      ctx.to(HttpContext).response.setHeader(HttpHeader.XContentTypeOptions, 'garbage');
    });
    const ctx = await runHelmet(undefined, { prior: [priorGarbage] });
    expect(ctx.response.headers.get(HttpHeader.XContentTypeOptions)).toBe('nosniff');
  });

  // Public ordering contract (STANDARDS §1.5): a middleware placed after helmet
  // writes later, so its value wins — helmet cannot block a later write.
  it('is overwritten by a subsequent middleware — subsequent wins', async () => {
    const subsequentOverride = defineMiddleware([HttpAdapter], () => (ctx) => {
      ctx.to(HttpContext).response.setHeader(HttpHeader.XContentTypeOptions, 'garbage');
    });
    const ctx = await runHelmet(undefined, { subsequent: [subsequentOverride] });
    expect(ctx.response.headers.get(HttpHeader.XContentTypeOptions)).toBe('garbage');
  });
});
