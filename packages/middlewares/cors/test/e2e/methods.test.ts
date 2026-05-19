import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { bootCorsApp, preflight, setupSilentLogger, type CorsTestApp } from './helpers';

describe('CORS / methods', () => {
  setupSilentLogger();

  describe('explicit list', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', methods: ['POST', 'PUT'] });
    });
    afterAll(async () => { await app.close(); });

    it('should set Access-Control-Allow-Methods to the configured list on preflight', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST'));
      const allow = String(res.headers.get('access-control-allow-methods'))
        .split(',').map((s) => s.trim());
      expect(allow).toEqual(expect.arrayContaining(['POST', 'PUT']));
    });
  });

  describe('wildcard methods with credentials', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', methods: ['*'], credentials: true });
    });
    afterAll(async () => { await app.close(); });

    it('should echo the requested method into Access-Control-Allow-Methods (not "*")', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'PATCH'));
      expect(res.headers.get('access-control-allow-methods')).toBe('PATCH');
    });
  });

  describe('wildcard methods without credentials', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: '*', methods: ['*'] });
    });
    afterAll(async () => { await app.close(); });

    it('should set Access-Control-Allow-Methods to "*"', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'DELETE'));
      expect(res.headers.get('access-control-allow-methods')).toBe('*');
    });
  });

  describe('Access-Control-Request-Method not in the allowed list', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({
        origin: 'https://x.com',
        methods: ['GET'],
        maxAge: 3600,
        exposedHeaders: ['X-Trace'],
        allowPrivateNetwork: true,
      });
    });
    afterAll(async () => { await app.close(); });

    it('should reject the preflight with 404 and strip every CORS response header (Fetch §4.10)', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'DELETE', {
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
});
