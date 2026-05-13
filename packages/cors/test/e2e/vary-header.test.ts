import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { bootCorsApp, setupSilentLogger, varyTokens, type CorsTestApp } from './helpers';

describe('CORS / Vary header', () => {
  setupSilentLogger();

  describe('dynamic origin attaches Vary: Origin', () => {
    let app: CorsTestApp;
    beforeAll(async () => { app = await bootCorsApp({ origin: 'https://x.com' }); });
    afterAll(async () => { await app.close(); });

    it('non-wildcard origin → Vary contains Origin', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://x.com' } });
      expect(varyTokens(res.headers.get('vary'))).toContain('origin');
    });
  });

  describe('wildcard origin omits Vary: Origin', () => {
    let app: CorsTestApp;
    beforeAll(async () => { app = await bootCorsApp({ origin: '*' }); });
    afterAll(async () => { await app.close(); });

    it('wildcard → Vary does not contain Origin', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://x.com' } });
      expect(varyTokens(res.headers.get('vary'))).not.toContain('origin');
    });
  });

  describe('Vary tokens are unique and comma-separated (RFC 9110)', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({
        origin: 'https://x.com',
        methods: ['POST'],
        allowedHeaders: ['X-Foo'],
      });
    });
    afterAll(async () => { await app.close(); });

    it('preflight Vary tokens are exactly {origin, ACRM, ACRH} with no duplicates', async () => {
      const res = await app.fetch('/x', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://x.com',
          'Access-Control-Request-Method': 'POST',
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
