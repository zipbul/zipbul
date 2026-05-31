/**
 * Unit spec for the `cookieMiddleware` factory (colocated with the source).
 *
 * Exercises the adapter-integration contract against a real `HttpContext` from
 * `@zipbul/http-adapter/testing` (so `ctx.to(HttpContext)` identity and `ctx.rawRequest`
 * behave as under a live dispatch). The framework-agnostic engine (`CookieParser` / `CookieJar`)
 * is covered separately; this file focuses on definition shape, the two-phase wiring, the
 * `cookieJarKey` publication, `Set-Cookie` flushing via `appendHeader`, and `isSecure` derivation.
 */
import { describe, expect, it } from 'bun:test';
import { asCookieError } from '../test/support';
import { HttpAdapter, HttpContext } from '@zipbul/http-adapter';
import { mockContext } from '@zipbul/http-adapter/testing';

import { CookieError } from './interfaces';
import { CookieErrorReason } from './enums';
import { cookieMiddleware } from './middleware';
import { cookieJarKey } from './context-keys';

const SECRET = 'gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg';

describe('cookieMiddleware factory — definition shape', () => {
  it('should return onRequest and beforeResponse definitions keyed to [HttpAdapter]', () => {
    const cm = cookieMiddleware();
    expect(cm.onRequest.adapters).toEqual([HttpAdapter]);
    expect(cm.beforeResponse.adapters).toEqual([HttpAdapter]);
    expect(typeof cm.onRequest.factory).toBe('function');
    expect(typeof cm.beforeResponse.factory).toBe('function');
  });

  it('should declare cookieJarKey in the onRequest provides', () => {
    const cm = cookieMiddleware();
    expect(cm.onRequest.provides).toEqual([cookieJarKey]);
  });

  it('should throw CookieError synchronously when options are invalid', () => {
    expect(() => cookieMiddleware({ secrets: ['short'] })).toThrow(CookieError);
  });

  it('should throw CookieError with WeakSecret reason for a weak secret', () => {
    try {
      cookieMiddleware({ secrets: ['short'] });
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(CookieError);
      expect(asCookieError(e).reason).toBe(CookieErrorReason.WeakSecret);
    }
  });
});

describe('cookieMiddleware — onRequest', () => {
  it('should publish a CookieJar carrying the parsed inbound Cookie header', () => {
    const ctx = mockContext({ headers: new Headers({ Cookie: 'sid=abc; theme=dark' }) });
    cookieMiddleware().onRequest.factory()(ctx);
    const jar = ctx.get(cookieJarKey);
    expect(jar).toBeDefined();
    expect(jar!.getRaw('sid')).toBe('abc');
    expect(jar!.getRaw('theme')).toBe('dark');
  });

  it('should publish an empty jar when no Cookie header is present', () => {
    const ctx = mockContext();
    cookieMiddleware().onRequest.factory()(ctx);
    const jar = ctx.get(cookieJarKey);
    expect(jar).toBeDefined();
    expect(jar!.has('sid')).toBe(false);
  });

  it('should no-op when rawRequest is undefined (consumed body / non-Bun adapter)', () => {
    const ctx = mockContext({ headers: new Headers({ Cookie: 'sid=abc' }) });
    ctx.consumeRawRequest();
    cookieMiddleware().onRequest.factory()(ctx);
    expect(ctx.get(cookieJarKey)).toBeUndefined();
  });

  it('should let a downstream handler read the jar via ctx.use', async () => {
    const ctx = mockContext({ headers: new Headers({ Cookie: 'session=signed' }) });
    cookieMiddleware().onRequest.factory()(ctx);
    const jar = ctx.to(HttpContext).use(cookieJarKey);
    expect(await jar.get('session')).toBe('signed');
  });
});

describe('cookieMiddleware — beforeResponse', () => {
  it('should flush a queued cookie as a Set-Cookie header', async () => {
    const ctx = mockContext({ headers: new Headers({ Cookie: '' }) });
    const cm = cookieMiddleware();
    cm.onRequest.factory()(ctx);
    ctx.use(cookieJarKey).set('token', 'xyz', { httpOnly: true });
    await cm.beforeResponse.factory()(ctx);
    const setCookie = ctx.response.headers.get('set-cookie');
    expect(setCookie).toContain('token=xyz');
    expect(setCookie).toContain('HttpOnly');
  });

  it('should emit one distinct Set-Cookie header per cookie (no folding)', async () => {
    const ctx = mockContext({ headers: new Headers({ Cookie: '' }) });
    const cm = cookieMiddleware();
    cm.onRequest.factory()(ctx);
    const jar = ctx.use(cookieJarKey);
    jar.set('a', '1');
    jar.set('b', '2');
    await cm.beforeResponse.factory()(ctx);
    const all = ctx.response.headers.getSetCookie();
    expect(all).toHaveLength(2);
    expect(all.some((h) => h.startsWith('a=1'))).toBe(true);
    expect(all.some((h) => h.startsWith('b=2'))).toBe(true);
  });

  it('should emit no Set-Cookie header when nothing was queued', async () => {
    const ctx = mockContext({ headers: new Headers({ Cookie: 'existing=value' }) });
    const cm = cookieMiddleware();
    cm.onRequest.factory()(ctx);
    await cm.beforeResponse.factory()(ctx);
    expect(ctx.response.headers.get('set-cookie')).toBeNull();
  });

  it('should no-op when no jar was published (onRequest did not run)', async () => {
    const ctx = mockContext();
    await cookieMiddleware().beforeResponse.factory()(ctx);
    expect(ctx.response.headers.get('set-cookie')).toBeNull();
  });

  it('should swallow a serialize-time error so one bad cookie cannot break the response', async () => {
    // SameSite=None over a plain-http request fails the Secure cross-field rule only at flush
    // (serialize) time. The beforeResponse handler must contain it: no throw escapes the response
    // pipeline, and no Set-Cookie is written for the offending cookie.
    const ctx = mockContext({ url: 'http://example.com/x', headers: new Headers({ Cookie: '' }) });
    const cm = cookieMiddleware();
    cm.onRequest.factory()(ctx);
    ctx.use(cookieJarKey).set('bad', 'v', { sameSite: 'none' });
    await cm.beforeResponse.factory()(ctx);
    expect(ctx.response.headers.get('set-cookie')).toBeNull();
  });

  it('should sign the flushed cookie when secrets are configured', async () => {
    const ctx = mockContext({ headers: new Headers({ Cookie: '' }) });
    const cm = cookieMiddleware({ secrets: [SECRET] });
    cm.onRequest.factory()(ctx);
    ctx.use(cookieJarKey).set('session', 'data');
    await cm.beforeResponse.factory()(ctx);
    expect(ctx.response.headers.get('set-cookie')).toContain('session=data.');
  });

  describe('isSecure derivation from the request URL', () => {
    it('should emit Secure for secure:"auto" over an https request', async () => {
      const ctx = mockContext({ url: 'https://example.com/x', headers: new Headers({ Cookie: '' }) });
      const cm = cookieMiddleware({ secure: 'auto' });
      cm.onRequest.factory()(ctx);
      ctx.use(cookieJarKey).set('session', 'v');
      await cm.beforeResponse.factory()(ctx);
      expect(ctx.response.headers.get('set-cookie')).toContain('Secure');
    });

    it('should not emit Secure for secure:"auto" over a plain http request', async () => {
      const ctx = mockContext({ url: 'http://example.com/x', headers: new Headers({ Cookie: '' }) });
      const cm = cookieMiddleware({ secure: 'auto' });
      cm.onRequest.factory()(ctx);
      ctx.use(cookieJarKey).set('session', 'v');
      await cm.beforeResponse.factory()(ctx);
      expect(ctx.response.headers.get('set-cookie')).not.toContain('Secure');
    });
  });
});
