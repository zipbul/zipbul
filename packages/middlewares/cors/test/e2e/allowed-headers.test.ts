import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { bootCorsApp, preflight, setupSilentLogger, varyTokens, type CorsTestApp } from './helpers';

describe('CORS / allowedHeaders', () => {
  setupSilentLogger();

  describe('explicit allowedHeaders with a matching Access-Control-Request-Headers', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', allowedHeaders: ['X-Foo', 'X-Bar'] });
    });
    afterAll(async () => { await app.close(); });

    it('should set Access-Control-Allow-Headers and append Vary: Access-Control-Request-Headers', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST', {
        'Access-Control-Request-Headers': 'X-Foo',
      }));
      const allow = String(res.headers.get('access-control-allow-headers'))
        .split(',').map((s) => s.trim().toLowerCase());
      expect(allow).toEqual(expect.arrayContaining(['x-foo', 'x-bar']));
      expect(varyTokens(res.headers.get('vary'))).toContain('access-control-request-headers');
    });
  });

  describe('explicit allowedHeaders with a mismatched Access-Control-Request-Headers', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({
        origin: 'https://x.com',
        allowedHeaders: ['X-Bar'],
        maxAge: 3600,
        exposedHeaders: ['X-Trace'],
        allowPrivateNetwork: true,
      });
    });
    afterAll(async () => { await app.close(); });

    it('should reject the preflight with 404 and strip every CORS response header (Fetch §4.10)', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST', {
        'Access-Control-Request-Headers': 'X-Foo',
        'Access-Control-Request-Private-Network': 'true',
      }));
      expect(res.status).toBe(404);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
      expect(res.headers.get('access-control-allow-credentials')).toBeNull();
      expect(res.headers.get('access-control-allow-methods')).toBeNull();
      expect(res.headers.get('access-control-allow-headers')).toBeNull();
      expect(res.headers.get('access-control-expose-headers')).toBeNull();
      expect(res.headers.get('access-control-max-age')).toBeNull();
      expect(res.headers.get('access-control-allow-private-network')).toBeNull();
      expect(res.headers.get('vary')).toBeNull();
    });
  });

  describe('allowedHeaders default (null) with Access-Control-Request-Headers present', () => {
    let app: CorsTestApp;
    beforeAll(async () => { app = await bootCorsApp({ origin: 'https://x.com' }); });
    afterAll(async () => { await app.close(); });

    it('should echo Access-Control-Request-Headers into Access-Control-Allow-Headers and append Vary: ACRH', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST', {
        'Access-Control-Request-Headers': 'X-Custom-A, X-Custom-B',
      }));
      const allow = String(res.headers.get('access-control-allow-headers')).toLowerCase();
      expect(allow).toContain('x-custom-a');
      expect(allow).toContain('x-custom-b');
      expect(varyTokens(res.headers.get('vary'))).toContain('access-control-request-headers');
    });
  });

  describe('allowedHeaders wildcard without credentials', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: '*', allowedHeaders: ['*'] });
    });
    afterAll(async () => { await app.close(); });

    it('should set Access-Control-Allow-Headers to "*"', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST', {
        'Access-Control-Request-Headers': 'X-Foo',
      }));
      expect(res.headers.get('access-control-allow-headers')).toBe('*');
    });
  });

  describe('allowedHeaders wildcard with credentials and no Access-Control-Request-Headers', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({
        origin: 'https://x.com',
        allowedHeaders: ['*'],
        credentials: true,
      });
    });
    afterAll(async () => { await app.close(); });

    it('should omit Access-Control-Allow-Headers and not append Vary: ACRH', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST'));
      expect(res.headers.get('access-control-allow-methods')).not.toBeNull();
      expect(res.headers.get('access-control-allow-headers')).toBeNull();
      expect(varyTokens(res.headers.get('vary'))).not.toContain('access-control-request-headers');
    });
  });

  describe('allowedHeaders wildcard with credentials and a non-Authorization Access-Control-Request-Headers', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({
        origin: 'https://x.com',
        allowedHeaders: ['*', 'authorization'],
        credentials: true,
      });
    });
    afterAll(async () => { await app.close(); });

    it('should echo the raw Access-Control-Request-Headers value verbatim (not "*")', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST', {
        'Access-Control-Request-Headers': 'X-Foo, X-Bar',
      }));
      const allow = String(res.headers.get('access-control-allow-headers'));
      expect(allow).not.toBe('*');
      expect(allow.toLowerCase()).toContain('x-foo');
    });
  });

  describe('allowedHeaders wildcard with Authorization not explicitly listed', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', allowedHeaders: ['*'] });
    });
    afterAll(async () => { await app.close(); });

    it('should reject the preflight when ACRH contains Authorization (CORS non-wildcard rule)', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST', {
        'Access-Control-Request-Headers': 'Authorization',
      }));
      expect(res.headers.get('access-control-allow-methods')).toBeNull();
    });
  });

  describe('Access-Control-Request-Headers with mixed case across multiple values', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', allowedHeaders: ['x-foo', 'X-Bar'] });
    });
    afterAll(async () => { await app.close(); });

    it('should match ACRH entries case-insensitively', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST', {
        'Access-Control-Request-Headers': 'X-FOO, x-bar',
      }));
      expect(res.headers.get('access-control-allow-headers')).not.toBeNull();
    });
  });

  describe('empty Access-Control-Request-Headers', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', methods: ['POST'] });
    });
    afterAll(async () => { await app.close(); });

    it('should accept the preflight and omit Access-Control-Allow-Headers', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST', {
        'Access-Control-Request-Headers': '',
      }));
      expect(String(res.headers.get('access-control-allow-methods'))).toContain('POST');
      expect(res.headers.get('access-control-allow-headers')).toBeNull();
    });
  });

  describe('allowedHeaders set to an explicit empty array with ACRH present', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', allowedHeaders: [] });
    });
    afterAll(async () => { await app.close(); });

    it('should reject the preflight when any ACRH is sent', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST', {
        'Access-Control-Request-Headers': 'X-Foo',
      }));
      expect(res.headers.get('access-control-allow-methods')).toBeNull();
    });
  });

  describe('allowedHeaders set to an explicit empty array without ACRH', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', allowedHeaders: [] });
    });
    afterAll(async () => { await app.close(); });

    it('should accept the preflight, omit Access-Control-Allow-Headers, and not append Vary: ACRH', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST'));
      expect(res.headers.get('access-control-allow-methods')).not.toBeNull();
      expect(res.headers.get('access-control-allow-headers')).toBeNull();
      expect(varyTokens(res.headers.get('vary'))).not.toContain('access-control-request-headers');
    });
  });

  describe('allowedHeaders wildcard with credentials and Authorization explicitly listed', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({
        origin: 'https://x.com',
        allowedHeaders: ['*', 'authorization'],
        credentials: true,
      });
    });
    afterAll(async () => { await app.close(); });

    it('should accept the preflight and echo the raw ACRH including Authorization', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST', {
        'Access-Control-Request-Headers': 'Authorization',
      }));
      expect(res.headers.get('access-control-allow-methods')).not.toBeNull();
      expect(String(res.headers.get('access-control-allow-headers')).toLowerCase())
        .toContain('authorization');
    });
  });
});
