import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { defineMiddleware } from '@zipbul/common';
import { HttpAdapter, HttpContext, HttpMethod } from '@zipbul/http-adapter';

import { bootCorsApp, preflight, setupSilentLogger, varyTokens, type CorsTestApp } from './helpers';

const stampVary = defineMiddleware([HttpAdapter], () => (ctx) => {
  ctx.to(HttpContext).response.appendHeader('Vary', 'Accept-Encoding');
});

describe('CORS / pipeline', () => {
  setupSilentLogger();

  describe('prior middleware appends Vary token before CORS runs', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com' }, { priorMiddlewares: [stampVary] });
    });
    afterAll(async () => { await app.close(); });

    it('should preserve the prior Vary token and append Origin', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://x.com' } });
      const tokens = varyTokens(res.headers.get('vary'));
      expect(tokens).toContain('accept-encoding');
      expect(tokens).toContain('origin');
    });
  });

  describe('prior middleware appends Vary token before CORS preflight runs', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp(
        { origin: 'https://x.com', methods: [HttpMethod.Post] },
        { priorMiddlewares: [stampVary] },
      );
    });
    afterAll(async () => { await app.close(); });

    it('should preserve the prior Vary token on preflight response', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', HttpMethod.Post));
      const tokens = varyTokens(res.headers.get('vary'));
      expect(tokens).toContain('accept-encoding');
      expect(tokens).toContain('origin');
      expect(tokens).toContain('access-control-request-method');
    });
  });

  describe('non-preflight request to missing route', () => {
    let app: CorsTestApp;
    beforeAll(async () => { app = await bootCorsApp({ origin: '*' }); });
    afterAll(async () => { await app.close(); });

    it('should return 404 with Access-Control-Allow-Origin preserved', async () => {
      const res = await app.fetch('/nope', { headers: { Origin: 'https://x.com' } });
      expect(res.status).toBe(404);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
    });
  });
});
