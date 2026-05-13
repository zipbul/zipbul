import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { bootCorsApp, preflight, setupSilentLogger, varyTokens, type CorsTestApp } from './helpers';

describe('CORS / preflight', () => {
  setupSilentLogger();

  describe('successful preflight returns optionsSuccessStatus + empty body', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', methods: ['POST'] });
    });
    afterAll(async () => { await app.close(); });

    it('204 with no body', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST'));
      expect(res.status).toBe(204);
      expect(await res.text()).toBe('');
    });
  });

  describe('custom optionsSuccessStatus = 200', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({
        origin: 'https://x.com',
        methods: ['POST'],
        optionsSuccessStatus: 200,
      });
    });
    afterAll(async () => { await app.close(); });

    it('returns 200', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST'));
      expect(res.status).toBe(200);
    });
  });

  describe('preflightContinue passes through (not short-circuit)', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({
        origin: 'https://x.com',
        methods: ['POST'],
        preflightContinue: true,
      });
    });
    afterAll(async () => { await app.close(); });

    it('all preflight headers attached and route progresses (404, no route)', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST'));
      expect(res.status).toBe(404);
      expect(res.headers.get('access-control-allow-origin')).toBe('https://x.com');
      expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    });
  });

  describe('maxAge: 3600', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', methods: ['POST'], maxAge: 3600 });
    });
    afterAll(async () => { await app.close(); });

    it('Access-Control-Max-Age: 3600', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST'));
      expect(res.headers.get('access-control-max-age')).toBe('3600');
    });
  });

  describe('maxAge: 0 still set', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', methods: ['POST'], maxAge: 0 });
    });
    afterAll(async () => { await app.close(); });

    it('Access-Control-Max-Age: 0', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST'));
      expect(res.headers.get('access-control-max-age')).toBe('0');
    });
  });

  describe('Vary multi-value on preflight (exact tokens)', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({
        origin: 'https://x.com',
        methods: ['POST'],
        allowedHeaders: ['X-Foo'],
      });
    });
    afterAll(async () => { await app.close(); });

    it('Vary contains exact tokens: origin, ACRM, ACRH', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST', {
        'Access-Control-Request-Headers': 'X-Foo',
      }));
      const tokens = varyTokens(res.headers.get('vary'));
      expect(tokens).toEqual(expect.arrayContaining([
        'origin',
        'access-control-request-method',
        'access-control-request-headers',
      ]));
    });
  });
});
