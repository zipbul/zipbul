import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { bootCorsApp, preflight, setupSilentLogger, type CorsTestApp } from './helpers';

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

  describe('maxAge: default (null) → header omitted', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', methods: ['POST'] });
    });
    afterAll(async () => { await app.close(); });

    it('Access-Control-Max-Age is not attached', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST'));
      expect(res.headers.get('access-control-max-age')).toBeNull();
    });
  });

  describe('OPTIONS without ACRM is treated as simple request (not preflight)', () => {
    let app: CorsTestApp;
    beforeAll(async () => { app = await bootCorsApp({ origin: '*' }); });
    afterAll(async () => { await app.close(); });

    it('OPTIONS + Origin (no ACRM) → ACAO set, no preflight headers', async () => {
      const res = await app.fetch('/x', {
        method: 'OPTIONS',
        headers: { Origin: 'https://x.com' },
      });
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('access-control-allow-methods')).toBeNull();
    });
  });

  describe('preflight body is empty and headerless', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', methods: ['POST'] });
    });
    afterAll(async () => { await app.close(); });

    it('204 preflight → empty body, no Content-Type, Content-Length: 0', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST'));
      expect(await res.text()).toBe('');
      expect(res.headers.get('content-type')).toBeNull();
      expect(res.headers.get('content-length')).toBe('0');
    });
  });
});
