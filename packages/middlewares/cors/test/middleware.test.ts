/**
 * Unit test for the `corsMiddleware` factory.
 *
 * The Cors engine itself is tested separately in `test/cors.test.ts`
 * (engine-level: `Cors.create().handle(request)`). This file covers the
 * adapter-bound middleware shape returned by `defineMiddleware([HttpAdapter], ...)`
 * by invoking the factory and driving a real `HttpContext` from
 * `@zipbul/http-adapter/testing`.
 */
import { describe, expect, it } from 'bun:test';

import { HttpHeader } from '@zipbul/http-adapter';
import { mockContext } from '@zipbul/http-adapter/testing';

import { corsMiddleware } from '../src/middleware';

const ALLOWED = 'https://allowed.example';

describe('corsMiddleware factory — unit (mockContext, no app boot)', () => {
  it('emits Allow-Origin on a simple request when the origin matches', async () => {
    const ctx = mockContext({ headers: new Headers({ Origin: ALLOWED }) });
    const handler = corsMiddleware({ origin: ALLOWED }).factory();
    await handler(ctx);
    expect(ctx.response.headers.get(HttpHeader.AccessControlAllowOrigin)).toBe(ALLOWED);
  });

  it('omits Allow-Origin when the origin does not match', async () => {
    const ctx = mockContext({ headers: new Headers({ Origin: 'https://blocked.example' }) });
    const handler = corsMiddleware({ origin: ALLOWED }).factory();
    await handler(ctx);
    expect(ctx.response.headers.get(HttpHeader.AccessControlAllowOrigin)).toBeNull();
  });

  it('no-ops when no Origin header is sent (same-origin request)', async () => {
    const ctx = mockContext();
    const handler = corsMiddleware({ origin: ALLOWED }).factory();
    await handler(ctx);
    expect(ctx.response.headers.get(HttpHeader.AccessControlAllowOrigin)).toBeNull();
  });
});
