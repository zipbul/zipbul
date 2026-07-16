import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { bootCorsApp, setupSilentLogger, varyTokens, type CorsTestApp } from './helpers';

describe('CORS / origin', () => {
  setupSilentLogger();

  describe('string origin allowed', () => {
    let app: CorsTestApp;
    beforeAll(async () => { app = await bootCorsApp({ origin: 'https://allowed.com' }); });
    afterAll(async () => { await app.close(); });

    it('should echo the request Origin into Access-Control-Allow-Origin and append Vary: Origin', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://allowed.com' } });
      expect(res.headers.get('access-control-allow-origin')).toBe('https://allowed.com');
      expect(varyTokens(res.headers.get('vary'))).toContain('origin');
    });
  });

  describe('wildcard origin', () => {
    let app: CorsTestApp;
    beforeAll(async () => { app = await bootCorsApp({ origin: '*' }); });
    afterAll(async () => { await app.close(); });

    it('should set Access-Control-Allow-Origin to "*" and omit Vary: Origin', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://anything.com' } });
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(varyTokens(res.headers.get('vary'))).not.toContain('origin');
    });
  });

  describe('RegExp origin that matches', () => {
    let app: CorsTestApp;
    beforeAll(async () => { app = await bootCorsApp({ origin: /\.example\.com$/ }); });
    afterAll(async () => { await app.close(); });

    it('should echo the request Origin', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://api.example.com' } });
      expect(res.headers.get('access-control-allow-origin')).toBe('https://api.example.com');
    });
  });

  describe('Array origin with a matching string entry', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: ['https://a.com', /\.b\.com$/] });
    });
    afterAll(async () => { await app.close(); });

    it('should echo the request Origin', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://a.com' } });
      expect(res.headers.get('access-control-allow-origin')).toBe('https://a.com');
    });
  });

  describe('Array origin with a matching RegExp entry', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: ['https://a.com', /\.b\.com$/] });
    });
    afterAll(async () => { await app.close(); });

    it('should echo the request Origin', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://api.b.com' } });
      expect(res.headers.get('access-control-allow-origin')).toBe('https://api.b.com');
    });
  });

  describe('boolean origin true', () => {
    let app: CorsTestApp;
    beforeAll(async () => { app = await bootCorsApp({ origin: true }); });
    afterAll(async () => { await app.close(); });

    it('should echo any request Origin', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://any.com' } });
      expect(res.headers.get('access-control-allow-origin')).toBe('https://any.com');
    });
  });

  describe('origin function returning true (sync)', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: (origin) => origin === 'https://fn.com' });
    });
    afterAll(async () => { await app.close(); });

    it('should echo the request Origin when the function approves it', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://fn.com' } });
      expect(res.headers.get('access-control-allow-origin')).toBe('https://fn.com');
    });
  });

  describe('origin function returning a Promise<true> (async)', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({
        origin: async (origin) => {
          await Promise.resolve();
          return origin === 'https://async.com';
        },
      });
    });
    afterAll(async () => { await app.close(); });

    it('should echo the request Origin when the async function approves it', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://async.com' } });
      expect(res.headers.get('access-control-allow-origin')).toBe('https://async.com');
    });
  });

  describe('origin function returning a string override', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: () => 'https://override.com' });
    });
    afterAll(async () => { await app.close(); });

    it('should set Access-Control-Allow-Origin to the returned string (overriding the request Origin)', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://other.com' } });
      expect(res.headers.get('access-control-allow-origin')).toBe('https://override.com');
    });
  });

  describe('origin "null" option matching an opaque-origin request', () => {
    let app: CorsTestApp;
    beforeAll(async () => { app = await bootCorsApp({ origin: 'null' }); });
    afterAll(async () => { await app.close(); });

    it('should echo the literal Origin: "null"', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'null' } });
      expect(res.headers.get('access-control-allow-origin')).toBe('null');
    });
  });

  describe('origin "null" option combined with credentials (opaque origin + credentialed request)', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'null', credentials: true });
    });
    afterAll(async () => { await app.close(); });

    it('should set Access-Control-Allow-Origin: null, Access-Control-Allow-Credentials: true, and Vary: Origin', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'null' } });
      expect(res.headers.get('access-control-allow-origin')).toBe('null');
      expect(res.headers.get('access-control-allow-credentials')).toBe('true');
      expect(varyTokens(res.headers.get('vary'))).toContain('origin');
    });
  });

  describe('no Origin header (NoOrigin reject)', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({
        origin: '*',
        maxAge: 3600,
        exposedHeaders: ['X-Trace'],
        allowPrivateNetwork: true,
      });
    });
    afterAll(async () => { await app.close(); });

    it('should emit the static wildcard ACAO on a no-Origin response (§7.2)', async () => {
      const res = await app.fetch('/x');
      expect(res.status).toBe(404);
      // §7.2 — a static `*` is sent on every response for the resource, including a
      // request with no Origin header, and without Vary.
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('vary')).toBeNull();
      // preflight-only / credentialed headers stay absent on this non-preflight path
      expect(res.headers.get('access-control-allow-credentials')).toBeNull();
      expect(res.headers.get('access-control-allow-methods')).toBeNull();
      expect(res.headers.get('access-control-allow-headers')).toBeNull();
      expect(res.headers.get('access-control-max-age')).toBeNull();
      expect(res.headers.get('access-control-allow-private-network')).toBeNull();
    });
  });

  describe('OriginNotAllowed reject (string origin mismatched)', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({
        origin: 'https://allowed.com',
        maxAge: 3600,
        exposedHeaders: ['X-Trace'],
        allowPrivateNetwork: true,
      });
    });
    afterAll(async () => { await app.close(); });

    it('should withhold the CORS grant but still declare Vary: Origin (§7.1)', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://evil.com' } });
      expect(res.status).toBe(404);
      // rejected → no grant headers
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
      expect(res.headers.get('access-control-allow-credentials')).toBeNull();
      expect(res.headers.get('access-control-allow-methods')).toBeNull();
      expect(res.headers.get('access-control-allow-headers')).toBeNull();
      expect(res.headers.get('access-control-expose-headers')).toBeNull();
      expect(res.headers.get('access-control-max-age')).toBeNull();
      expect(res.headers.get('access-control-allow-private-network')).toBeNull();
      // §7.1 — the resource's ACAO presence varies by Origin, so a shared cache must
      // not replay this ACAO-less body to an allowed origin.
      expect(varyTokens(res.headers.get('vary'))).toContain('origin');
    });
  });

  describe('OriginNotAllowed reject (RegExp origin mismatched)', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: /^https:\/\/allowed\.com$/ });
    });
    afterAll(async () => { await app.close(); });

    it('should omit Access-Control-Allow-Origin', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://other.com' } });
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  });

  describe('OriginNotAllowed reject (array with no matching entry)', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: ['https://a.com', /\.b\.com$/] });
    });
    afterAll(async () => { await app.close(); });

    it('should omit Access-Control-Allow-Origin', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://c.com' } });
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('should still declare Vary: Origin on the rejected response (§7.1)', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://c.com' } });
      expect(varyTokens(res.headers.get('vary'))).toContain('origin');
    });
  });

  describe('OriginNotAllowed reject (origin function returning false)', () => {
    let app: CorsTestApp;
    beforeAll(async () => { app = await bootCorsApp({ origin: () => false }); });
    afterAll(async () => { await app.close(); });

    it('should omit Access-Control-Allow-Origin', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://any.com' } });
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  });

  describe('OriginNotAllowed reject (origin function returning an empty string)', () => {
    let app: CorsTestApp;
    beforeAll(async () => { app = await bootCorsApp({ origin: () => '' }); });
    afterAll(async () => { await app.close(); });

    it('should treat the empty return as a non-match and omit Access-Control-Allow-Origin', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://x.com' } });
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  });

  describe('OriginNotAllowed reject (boolean origin false)', () => {
    let app: CorsTestApp;
    beforeAll(async () => { app = await bootCorsApp({ origin: false }); });
    afterAll(async () => { await app.close(); });

    it('should never attach Access-Control-Allow-Origin', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://any.com' } });
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  });

  describe('origin function throwing synchronously', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({
        origin: () => {
          throw new Error('origin fn boom');
        },
      });
    });
    afterAll(async () => { await app.close(); });

    it('should propagate the error and respond 500 with no Access-Control-Allow-Origin', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://x.com' } });
      expect(res.status).toBe(500);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  });

  describe('origin function returning a rejected Promise (async throw)', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({
        origin: async () => {
          await Promise.resolve();
          throw new Error('async origin fn boom');
        },
      });
    });
    afterAll(async () => { await app.close(); });

    it('should propagate the error and respond 500 with no Access-Control-Allow-Origin', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://x.com' } });
      expect(res.status).toBe(500);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  });
});
