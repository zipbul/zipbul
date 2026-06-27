import { HttpMethod } from '@zipbul/http-adapter';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { bootCorsApp, setupSilentLogger, varyTokens, type CorsTestApp } from './helpers';

describe('CORS / vary', () => {
  setupSilentLogger();

  describe('dynamic (non-wildcard) origin', () => {
    let app: CorsTestApp;
    beforeAll(async () => { app = await bootCorsApp({ origin: 'https://x.com' }); });
    afterAll(async () => { await app.close(); });

    it('should append Origin to the Vary header', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://x.com' } });
      expect(varyTokens(res.headers.get('vary'))).toContain('origin');
    });
  });

  describe('wildcard origin', () => {
    let app: CorsTestApp;
    beforeAll(async () => { app = await bootCorsApp({ origin: '*' }); });
    afterAll(async () => { await app.close(); });

    it('should not append Origin to the Vary header', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://x.com' } });
      expect(varyTokens(res.headers.get('vary'))).not.toContain('origin');
    });
  });

  describe('preflight with allowedHeaders explicit', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({
        origin: 'https://x.com',
        methods: [HttpMethod.Post],
        allowedHeaders: ['X-Foo'],
      });
    });
    afterAll(async () => { await app.close(); });

    it('should set Vary to exactly {Origin, Access-Control-Request-Method, Access-Control-Request-Headers} without duplicates', async () => {
      const res = await app.fetch('/x', {
        method: HttpMethod.Options,
        headers: {
          Origin: 'https://x.com',
          'Access-Control-Request-Method': HttpMethod.Post,
          'Access-Control-Request-Headers': 'X-Foo',
        },
      });
      const tokens = varyTokens(res.headers.get('vary'));
      expect(new Set(tokens).size).toBe(tokens.length);
      expect(tokens).toEqual(expect.arrayContaining([
        'origin',
        'access-control-request-method',
        'access-control-request-headers',
      ]));
    });
  });
});
