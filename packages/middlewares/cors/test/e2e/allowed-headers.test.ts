import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { bootCorsApp, preflight, setupSilentLogger, varyTokens, type CorsTestApp } from './helpers';

describe('CORS / allowedHeaders', () => {
  setupSilentLogger();

  describe('explicit allowedHeaders + matched ACRH', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', allowedHeaders: ['X-Foo', 'X-Bar'] });
    });
    afterAll(async () => { await app.close(); });

    it('sets Allow-Headers and Vary contains Access-Control-Request-Headers', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST', {
        'Access-Control-Request-Headers': 'X-Foo',
      }));
      const allow = String(res.headers.get('access-control-allow-headers'))
        .split(',').map((s) => s.trim().toLowerCase());
      expect(allow).toEqual(expect.arrayContaining(['x-foo', 'x-bar']));
      expect(varyTokens(res.headers.get('vary'))).toContain('access-control-request-headers');
    });
  });

  describe('explicit allowedHeaders + ACRH mismatch → Reject (Fetch §4.10 wire invariants)', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', allowedHeaders: ['X-Bar'] });
    });
    afterAll(async () => { await app.close(); });

    it('preflight with disallowed ACRH → 404 with no CORS headers and route progresses', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST', {
        'Access-Control-Request-Headers': 'X-Foo',
      }));
      expect(res.status).toBe(404);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
      expect(res.headers.get('access-control-allow-methods')).toBeNull();
      expect(res.headers.get('access-control-allow-headers')).toBeNull();
    });
  });

  describe('allowedHeaders default (echo mode) + ACRH present', () => {
    let app: CorsTestApp;
    beforeAll(async () => { app = await bootCorsApp({ origin: 'https://x.com' }); });
    afterAll(async () => { await app.close(); });

    it('echoes ACRH into Allow-Headers and appends Vary: ACRH', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST', {
        'Access-Control-Request-Headers': 'X-Custom-A, X-Custom-B',
      }));
      const allow = String(res.headers.get('access-control-allow-headers')).toLowerCase();
      expect(allow).toContain('x-custom-a');
      expect(allow).toContain('x-custom-b');
      expect(varyTokens(res.headers.get('vary'))).toContain('access-control-request-headers');
    });
  });

  describe('allowedHeaders wildcard without credentials → "*"', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: '*', allowedHeaders: ['*'] });
    });
    afterAll(async () => { await app.close(); });

    it('Allow-Headers is "*"', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST', {
        'Access-Control-Request-Headers': 'X-Foo',
      }));
      expect(res.headers.get('access-control-allow-headers')).toBe('*');
    });
  });

  describe('allowedHeaders wildcard + credentials + no ACRH → header omitted', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({
        origin: 'https://x.com',
        allowedHeaders: ['*'],
        credentials: true,
      });
    });
    afterAll(async () => { await app.close(); });

    it('preflight without ACRH → Allow-Headers omitted', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST'));
      expect(res.headers.get('access-control-allow-methods')).not.toBeNull();
      expect(res.headers.get('access-control-allow-headers')).toBeNull();
    });
  });

  describe('allowedHeaders wildcard + credentials → raw ACRH echo', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({
        origin: 'https://x.com',
        allowedHeaders: ['*', 'authorization'],
        credentials: true,
      });
    });
    afterAll(async () => { await app.close(); });

    it('echoes raw ACRH value (not "*")', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST', {
        'Access-Control-Request-Headers': 'X-Foo, X-Bar',
      }));
      const allow = String(res.headers.get('access-control-allow-headers'));
      expect(allow).not.toBe('*');
      expect(allow.toLowerCase()).toContain('x-foo');
    });
  });

  describe('allowedHeaders wildcard + Authorization not listed → Reject', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', allowedHeaders: ['*'] });
    });
    afterAll(async () => { await app.close(); });

    it('preflight with ACRH: Authorization → no Allow-Methods (CORS non-wildcard rule)', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST', {
        'Access-Control-Request-Headers': 'Authorization',
      }));
      expect(res.headers.get('access-control-allow-methods')).toBeNull();
    });
  });

  describe('ACRH multi-value (mixed case)', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', allowedHeaders: ['x-foo', 'X-Bar'] });
    });
    afterAll(async () => { await app.close(); });

    it('matches case-insensitive multi-value', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST', {
        'Access-Control-Request-Headers': 'X-FOO, x-bar',
      }));
      expect(res.headers.get('access-control-allow-headers')).not.toBeNull();
    });
  });

  describe('ACRH blank/empty', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', methods: ['POST'] });
    });
    afterAll(async () => { await app.close(); });

    it('preflight with empty ACRH → preflight succeeds, Allow-Headers omitted', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST', {
        'Access-Control-Request-Headers': '',
      }));
      expect(String(res.headers.get('access-control-allow-methods'))).toContain('POST');
      expect(res.headers.get('access-control-allow-headers')).toBeNull();
    });
  });

  describe('allowedHeaders: [] explicit empty', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', allowedHeaders: [] });
    });
    afterAll(async () => { await app.close(); });

    it('preflight with ACRH → Reject (no Allow-Methods)', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST', {
        'Access-Control-Request-Headers': 'X-Foo',
      }));
      expect(res.headers.get('access-control-allow-methods')).toBeNull();
    });

    it('preflight without ACRH → succeeds, Allow-Headers omitted, Vary does not contain ACRH', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST'));
      expect(res.headers.get('access-control-allow-methods')).not.toBeNull();
      expect(res.headers.get('access-control-allow-headers')).toBeNull();
      expect(varyTokens(res.headers.get('vary'))).not.toContain('access-control-request-headers');
    });
  });

  describe('wildcard + credentials + Authorization explicit → succeeds', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({
        origin: 'https://x.com',
        allowedHeaders: ['*', 'authorization'],
        credentials: true,
      });
    });
    afterAll(async () => { await app.close(); });

    it('preflight with Authorization in ACRH → preflight succeeds with raw echo', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST', {
        'Access-Control-Request-Headers': 'Authorization',
      }));
      expect(res.headers.get('access-control-allow-methods')).not.toBeNull();
      expect(String(res.headers.get('access-control-allow-headers')).toLowerCase())
        .toContain('authorization');
    });
  });
});
