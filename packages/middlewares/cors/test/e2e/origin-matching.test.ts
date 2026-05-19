import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { bootCorsApp, setupSilentLogger, varyTokens, type CorsTestApp } from './helpers';

describe('CORS / origin matching', () => {
  setupSilentLogger();

  describe('string origin allowed', () => {
    let app: CorsTestApp;
    beforeAll(async () => { app = await bootCorsApp({ origin: 'https://allowed.com' }); });
    afterAll(async () => { await app.close(); });

    it('echoes ACAO and adds Vary: Origin', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://allowed.com' } });
      expect(res.headers.get('access-control-allow-origin')).toBe('https://allowed.com');
      expect(varyTokens(res.headers.get('vary'))).toContain('origin');
    });
  });

  describe('string origin mismatched', () => {
    let app: CorsTestApp;
    beforeAll(async () => { app = await bootCorsApp({ origin: 'https://allowed.com' }); });
    afterAll(async () => { await app.close(); });

    it('does not attach ACAO', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://evil.com' } });
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  });

  describe('wildcard origin', () => {
    let app: CorsTestApp;
    beforeAll(async () => { app = await bootCorsApp({ origin: '*' }); });
    afterAll(async () => { await app.close(); });

    it('sets ACAO: * and omits Vary: Origin', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://anything.com' } });
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(varyTokens(res.headers.get('vary'))).not.toContain('origin');
    });
  });

  describe('RegExp origin', () => {
    let app: CorsTestApp;
    beforeAll(async () => { app = await bootCorsApp({ origin: /\.example\.com$/ }); });
    afterAll(async () => { await app.close(); });

    it('matched RegExp → echoes origin', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://api.example.com' } });
      expect(res.headers.get('access-control-allow-origin')).toBe('https://api.example.com');
    });

    it('mismatched RegExp → no ACAO', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://other.org' } });
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  });

  describe('Array origin (string + RegExp)', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: ['https://a.com', /\.b\.com$/] });
    });
    afterAll(async () => { await app.close(); });

    it('matches string member', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://a.com' } });
      expect(res.headers.get('access-control-allow-origin')).toBe('https://a.com');
    });

    it('matches regex member', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://api.b.com' } });
      expect(res.headers.get('access-control-allow-origin')).toBe('https://api.b.com');
    });

    it('no member matches → no ACAO', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://c.com' } });
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  });

  describe('function origin', () => {
    describe('sync returns true', () => {
      let app: CorsTestApp;
      beforeAll(async () => {
        app = await bootCorsApp({ origin: (origin) => origin === 'https://fn.com' });
      });
      afterAll(async () => { await app.close(); });

      it('echoes matched origin', async () => {
        const res = await app.fetch('/x', { headers: { Origin: 'https://fn.com' } });
        expect(res.headers.get('access-control-allow-origin')).toBe('https://fn.com');
      });
    });

    describe('sync returns false', () => {
      let app: CorsTestApp;
      beforeAll(async () => {
        app = await bootCorsApp({ origin: () => false });
      });
      afterAll(async () => { await app.close(); });

      it('does not attach ACAO', async () => {
        const res = await app.fetch('/x', { headers: { Origin: 'https://any.com' } });
        expect(res.headers.get('access-control-allow-origin')).toBeNull();
      });
    });

    describe('async returns true', () => {
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

      it('echoes matched origin', async () => {
        const res = await app.fetch('/x', { headers: { Origin: 'https://async.com' } });
        expect(res.headers.get('access-control-allow-origin')).toBe('https://async.com');
      });
    });

    describe('returns string override', () => {
      let app: CorsTestApp;
      beforeAll(async () => {
        app = await bootCorsApp({ origin: () => 'https://override.com' });
      });
      afterAll(async () => { await app.close(); });

      it('echoes the returned string (overriding request Origin)', async () => {
        const res = await app.fetch('/x', { headers: { Origin: 'https://other.com' } });
        expect(res.headers.get('access-control-allow-origin')).toBe('https://override.com');
      });
    });

    describe('returns empty string', () => {
      let app: CorsTestApp;
      beforeAll(async () => {
        app = await bootCorsApp({ origin: () => '' });
      });
      afterAll(async () => { await app.close(); });

      it('treats empty as no-match → no ACAO', async () => {
        const res = await app.fetch('/x', { headers: { Origin: 'https://x.com' } });
        expect(res.headers.get('access-control-allow-origin')).toBeNull();
      });
    });

    describe('throws', () => {
      let app: CorsTestApp;
      beforeAll(async () => {
        app = await bootCorsApp({
          origin: () => {
            throw new Error('origin fn boom');
          },
        });
      });
      afterAll(async () => { await app.close(); });

      it('propagates → wire 500 with no ACAO', async () => {
        const res = await app.fetch('/x', { headers: { Origin: 'https://x.com' } });
        expect(res.status).toBe(500);
        expect(res.headers.get('access-control-allow-origin')).toBeNull();
      });
    });
  });

  describe('boolean origin true', () => {
    let app: CorsTestApp;
    beforeAll(async () => { app = await bootCorsApp({ origin: true }); });
    afterAll(async () => { await app.close(); });

    it('echoes any Origin', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://any.com' } });
      expect(res.headers.get('access-control-allow-origin')).toBe('https://any.com');
    });
  });

  describe('boolean origin false', () => {
    let app: CorsTestApp;
    beforeAll(async () => { app = await bootCorsApp({ origin: false }); });
    afterAll(async () => { await app.close(); });

    it('never attaches ACAO', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://any.com' } });
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  });

  describe('Origin: "null" (sandboxed iframe)', () => {
    let app: CorsTestApp;
    beforeAll(async () => { app = await bootCorsApp({ origin: 'null' }); });
    afterAll(async () => { await app.close(); });

    it('matches when option is "null"', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'null' } });
      expect(res.headers.get('access-control-allow-origin')).toBe('null');
    });
  });

  describe('no Origin header (non-CORS request) → NoOrigin reject (Fetch §4.10 wire invariants)', () => {
    let app: CorsTestApp;
    beforeAll(async () => { app = await bootCorsApp({ origin: '*' }); });
    afterAll(async () => { await app.close(); });

    it('route progresses to 404 with no CORS headers', async () => {
      const res = await app.fetch('/x');
      expect(res.status).toBe(404);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
      expect(res.headers.get('access-control-allow-credentials')).toBeNull();
      expect(res.headers.get('access-control-expose-headers')).toBeNull();
    });
  });

  describe('OriginNotAllowed → reject (Fetch §4.10 wire invariants)', () => {
    let app: CorsTestApp;
    beforeAll(async () => { app = await bootCorsApp({ origin: 'https://allowed.com' }); });
    afterAll(async () => { await app.close(); });

    it('mismatched origin → 404 with no CORS headers', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://evil.com' } });
      expect(res.status).toBe(404);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
      expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    });
  });

  describe('OriginFn rejected Promise (async throw) → wire 500', () => {
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

    it('propagates → wire 500 with no ACAO', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://x.com' } });
      expect(res.status).toBe(500);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  });
});
