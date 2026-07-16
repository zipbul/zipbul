import { HttpHeader } from '@zipbul/http-adapter';
import { mockContext } from '@zipbul/http-adapter/testing';

import { describe, expect, it } from 'bun:test';

import { helmetMiddleware } from './helmet';

async function run(options?: Parameters<typeof helmetMiddleware>[0]) {
  const ctx = mockContext({});
  await helmetMiddleware(options).factory()(ctx);
  return ctx;
}

describe('helmetMiddleware — X-Content-Type-Options', () => {
  // STANDARDS §1.3: secure-by-default → header present with default config.
  // §1.2: the value is exactly `nosniff`.
  it('emits x-content-type-options: nosniff by default', async () => {
    const ctx = await run();
    expect(ctx.response.headers.get(HttpHeader.XContentTypeOptions)).toBe('nosniff');
  });

  // Emission is gated by the option.
  it('omits the header when xContentTypeOptions is false', async () => {
    const ctx = await run({ xContentTypeOptions: false });
    expect(ctx.response.headers.get(HttpHeader.XContentTypeOptions)).toBeNull();
  });

  // STANDARDS §1.5: setHeader replaces — a pre-existing header is overwritten,
  // never duplicated, so the UA's values[0] stays `nosniff`.
  it('overwrites a pre-existing value, leaving a single nosniff', async () => {
    const ctx = mockContext({});
    ctx.response.setHeader(HttpHeader.XContentTypeOptions, 'garbage');
    await helmetMiddleware().factory()(ctx);
    expect(ctx.response.headers.get(HttpHeader.XContentTypeOptions)).toBe('nosniff');
  });

  it('throws at registration on a wrong-typed option', () => {
    // @ts-expect-error — boolean field given a string; boot-time validation.
    expect(() => helmetMiddleware({ xContentTypeOptions: 'yes' })).toThrow();
  });
});
