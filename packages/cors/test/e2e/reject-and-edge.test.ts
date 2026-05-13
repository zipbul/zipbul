import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { bootCorsApp, preflight, setupSilentLogger, type CorsTestApp } from './helpers';

describe('CORS / reject paths and edge cases', () => {
  setupSilentLogger();

  describe('MethodNotAllowed Reject → no CORS headers (Fetch §4.10)', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', methods: ['GET'] });
    });
    afterAll(async () => { await app.close(); });

    it('disallowed preflight method → no ACAO/ACAM and route progresses (404)', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'DELETE'));
      expect(res.status).toBe(404);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
      expect(res.headers.get('access-control-allow-methods')).toBeNull();
    });
  });

  describe('HeaderNotAllowed Reject → no CORS headers', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', allowedHeaders: ['X-Bar'] });
    });
    afterAll(async () => { await app.close(); });

    it('disallowed preflight header → no ACAO/ACAM/ACAH and route progresses (404)', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST', {
        'Access-Control-Request-Headers': 'X-Foo',
      }));
      expect(res.status).toBe(404);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
      expect(res.headers.get('access-control-allow-methods')).toBeNull();
      expect(res.headers.get('access-control-allow-headers')).toBeNull();
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

  describe('404 response preserves OnRequest CORS headers', () => {
    let app: CorsTestApp;
    beforeAll(async () => { app = await bootCorsApp({ origin: '*' }); });
    afterAll(async () => { await app.close(); });

    it('non-preflight request to missing route → 404 with ACAO', async () => {
      const res = await app.fetch('/nope', { headers: { Origin: 'https://x.com' } });
      expect(res.status).toBe(404);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
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
