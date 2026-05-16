import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { bootCorsApp, setupSilentLogger, varyTokens, type CorsTestApp } from './helpers';

describe('CORS / credentials', () => {
  setupSilentLogger();

  describe('credentials: true + matched origin', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', credentials: true });
    });
    afterAll(async () => { await app.close(); });

    it('attaches ACAC: true and ACAO echo with Vary: Origin', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://x.com' } });
      expect(res.headers.get('access-control-allow-credentials')).toBe('true');
      expect(res.headers.get('access-control-allow-origin')).toBe('https://x.com');
      expect(varyTokens(res.headers.get('vary'))).toContain('origin');
    });
  });

  describe('credentials default (false)', () => {
    let app: CorsTestApp;
    beforeAll(async () => { app = await bootCorsApp({ origin: '*' }); });
    afterAll(async () => { await app.close(); });

    it('does not attach ACAC', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://x.com' } });
      expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    });
  });
});
