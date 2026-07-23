import { describe, expect, it } from 'bun:test';

import { defineMiddleware } from '@zipbul/common';
import { HttpAdapter, HttpContext, HttpHeader } from '@zipbul/http-adapter';

import { ReferrerPolicyToken } from '../../index';

import { runHelmet } from './helpers';

describe('helmetMiddleware — Referrer-Policy', () => {
  // STANDARDS §2.8: secure-by-default → header present with default config.
  it('emits referrer-policy: no-referrer by default', async () => {
    const ctx = await runHelmet();
    expect(ctx.response.headers.get(HttpHeader.ReferrerPolicy)).toBe('no-referrer');
  });

  // Emission is gated by the option.
  it('omits the header when referrerPolicy is false', async () => {
    const ctx = await runHelmet({ referrerPolicy: false });
    expect(ctx.response.headers.get(HttpHeader.ReferrerPolicy)).toBeNull();
  });

  // STANDARDS §2.4, §2.11: a fallback list is joined into one header value.
  it('joins an array into a comma-separated header', async () => {
    const ctx = await runHelmet({
      referrerPolicy: [ReferrerPolicyToken.NoReferrer, ReferrerPolicyToken.StrictOrigin],
    });
    expect(ctx.response.headers.get(HttpHeader.ReferrerPolicy)).toBe(
      'no-referrer, strict-origin',
    );
  });

  // STANDARDS §2.11: this emitter performs one replacing write (setHeader), so a
  // value it wrote earlier is overwritten, not duplicated. It does not stop a
  // later middleware or proxy from appending another value.
  it('overwrites a pre-existing value, leaving a single header', async () => {
    const priorGarbage = defineMiddleware([HttpAdapter], () => (ctx) => {
      ctx.to(HttpContext).response.setHeader(HttpHeader.ReferrerPolicy, 'unsafe-url');
    });
    const ctx = await runHelmet(undefined, { prior: [priorGarbage] });
    expect(ctx.response.headers.get(HttpHeader.ReferrerPolicy)).toBe('no-referrer');
  });

  // Public ordering contract (STANDARDS §2.11): a middleware placed after helmet
  // writes later, so its value wins — helmet cannot block a later write.
  it('is overwritten by a subsequent middleware — subsequent wins', async () => {
    const subsequentOverride = defineMiddleware([HttpAdapter], () => (ctx) => {
      ctx.to(HttpContext).response.setHeader(HttpHeader.ReferrerPolicy, 'unsafe-url');
    });
    const ctx = await runHelmet(undefined, { subsequent: [subsequentOverride] });
    expect(ctx.response.headers.get(HttpHeader.ReferrerPolicy)).toBe('unsafe-url');
  });
});
