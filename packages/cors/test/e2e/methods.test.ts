import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { bootCorsApp, preflight, setupSilentLogger, type CorsTestApp } from './helpers';

describe('CORS / methods', () => {
  setupSilentLogger();

  describe('methods explicit list', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', methods: ['POST', 'PUT'] });
    });
    afterAll(async () => { await app.close(); });

    it('preflight Allow-Methods includes listed methods', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST'));
      const allow = (res.headers.get('access-control-allow-methods') ?? '')
        .split(',').map((s) => s.trim());
      expect(allow).toEqual(expect.arrayContaining(['POST', 'PUT']));
    });
  });

  describe('methods wildcard + credentials → ACRM echo', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', methods: ['*'], credentials: true });
    });
    afterAll(async () => { await app.close(); });

    it('Allow-Methods echoes requested method (not *)', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'PATCH'));
      expect(res.headers.get('access-control-allow-methods')).toBe('PATCH');
    });
  });

  describe('methods wildcard without credentials → "*"', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: '*', methods: ['*'] });
    });
    afterAll(async () => { await app.close(); });

    it('Allow-Methods is "*"', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'DELETE'));
      expect(res.headers.get('access-control-allow-methods')).toBe('*');
    });
  });

  describe('ACRM not in methods → Reject', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', methods: ['GET'] });
    });
    afterAll(async () => { await app.close(); });

    it('preflight with disallowed method → no Allow-Methods', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'DELETE'));
      expect(res.headers.get('access-control-allow-methods')).toBeNull();
    });
  });
});
