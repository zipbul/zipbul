/**
 * Real end-to-end: a Bun server booted via @zipbul/tck with the cookie middleware pair. Verifies the
 * INBOUND path — the OnRequest parser publishes a CookieJar that downstream middleware reads, decoded
 * and (when configured) unsigned/decrypted, with the request actually crossing the wire via fetch().
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { defineMiddleware } from '@zipbul/common';
import { HttpAdapter, HttpContext } from '@zipbul/http-adapter';

import { cookieJarKey, CookieParser } from '../../index';
import { Cookie } from 'bun';
import { bootCookieApp, setupSilentLogger, type CookieTestApp } from './helpers';
import { expectOk } from '../support';

/** Echoes the RAW (undecoded-by-jar) value of `name` into the `x-raw` response header. */
const echoRaw = (name: string) =>
  defineMiddleware([HttpAdapter], () => (ctx) => {
    const value = ctx.to(HttpContext).use(cookieJarKey).getRaw(name);
    if (value !== undefined) {
      ctx.to(HttpContext).response.setHeader('x-raw', value);
    }
  });

/** Echoes the DECODED (decrypt→unsign) value of `name` into the `x-get` response header. */
const echoGet = (name: string) =>
  defineMiddleware([HttpAdapter], () => async (ctx) => {
    const result = await ctx.to(HttpContext).use(cookieJarKey).get(name);
    if (typeof result === 'string') {
      ctx.to(HttpContext).response.setHeader('x-get', result);
    }
  });

const SECRET = 'gHBB3MwkPytgNA9vApSMJRDqJIPMNXgLrHUKSJZy1Kg';
const ENC = '9v7BAwKpXHWZnoKZIHV2XWch22HvF8bleOM6t4nc-A4';

describe('cookie e2e / inbound parse', () => {
  setupSilentLogger();

  describe('plain cookie parsing', () => {
    let app: CookieTestApp;
    beforeAll(async () => { app = await bootCookieApp({}, { onRequest: [echoRaw('sid')] }); });
    afterAll(async () => { await app.close(); });

    it('should expose a raw inbound cookie value to downstream middleware', async () => {
      const res = await app.fetch('/x', { headers: { Cookie: 'sid=abc123; theme=dark' } });
      expect(res.headers.get('x-raw')).toBe('abc123');
    });

    it('should expose nothing when the requested cookie is absent', async () => {
      const res = await app.fetch('/x', { headers: { Cookie: 'other=1' } });
      expect(res.headers.get('x-raw')).toBeNull();
    });

    it('must not let a malformed same-name duplicate corrupt the valid value', async () => {
      const res = await app.fetch('/x', { headers: { Cookie: 'sid=valid123; sid=%ff' } });
      expect(res.headers.get('x-raw')).toBe('valid123');
    });

    it('tolerates multiple Cookie request headers (RFC 6265bis §4.2.1)', async () => {
      // Two distinct Cookie header lines; the runtime joins them with "; " before the parser sees them.
      const headers = new Headers();
      headers.append('cookie', 'theme=dark');
      headers.append('cookie', 'sid=fromSecondHeader');
      const res = await app.fetch('/x', { headers });
      expect(res.headers.get('x-raw')).toBe('fromSecondHeader');
    });
  });

  describe('signed cookie round-trip', () => {
    let app: CookieTestApp;
    beforeAll(async () => { app = await bootCookieApp({ secrets: [SECRET] }, { onRequest: [echoGet('session')] }); });
    afterAll(async () => { await app.close(); });

    it('should unsign a validly-signed inbound cookie', async () => {
      const signed = expectOk(CookieParser.create({ secrets: [SECRET] }).sign(new Cookie('session', 'user:42')));
      const res = await app.fetch('/x', { headers: { Cookie: `session=${signed.value}` } });
      expect(res.headers.get('x-get')).toBe('user:42');
    });

    it('should not expose a tampered signed cookie', async () => {
      const res = await app.fetch('/x', { headers: { Cookie: 'session=user:42.forgedsig' } });
      expect(res.headers.get('x-get')).toBeNull();
    });
  });

  describe('encrypted cookie round-trip', () => {
    let app: CookieTestApp;
    beforeAll(async () => { app = await bootCookieApp({ encryptionSecret: ENC }, { onRequest: [echoGet('secret')] }); });
    afterAll(async () => { await app.close(); });

    it('should decrypt a validly-encrypted inbound cookie', async () => {
      const enc = expectOk(await CookieParser.create({ encryptionSecret: ENC }).encrypt(new Cookie('secret', 'classified')));
      const res = await app.fetch('/x', { headers: { Cookie: `secret=${enc.value}` } });
      expect(res.headers.get('x-get')).toBe('classified');
    });
  });

  // NOTE: The OUTBOUND writer (beforeResponse) is intentionally not wire-tested here. It runs only in
  // the post-route pipeline, and the @zipbul/tck harness boots an app with no AOT-compiled routes (there
  // is no runtime route-registration API), so every request 404s before the post-route phases execute —
  // the same constraint that prevents any post-route middleware from being wire-tested. The writer is
  // covered against the REAL HttpContext/HttpResponse (not mocks) in src/middleware.spec.ts: appendHeader
  // flush, multiple-cookie no-fold, no-stage, and isSecure derivation.
});
