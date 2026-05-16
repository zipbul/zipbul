import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { bootCorsApp, preflight, setupSilentLogger, type CorsTestApp } from './helpers';

describe('CORS / Private Network Access (PNA)', () => {
  setupSilentLogger();

  describe('allowPrivateNetwork=true + ACR-Private-Network: true', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({
        origin: 'https://x.com',
        methods: ['POST'],
        allowPrivateNetwork: true,
      });
    });
    afterAll(async () => { await app.close(); });

    it('attaches Access-Control-Allow-Private-Network: true', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST', {
        'Access-Control-Request-Private-Network': 'true',
      }));
      expect(res.headers.get('access-control-allow-private-network')).toBe('true');
    });
  });

  describe('allowPrivateNetwork=true but no request header → no response header', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({
        origin: 'https://x.com',
        methods: ['POST'],
        allowPrivateNetwork: true,
      });
    });
    afterAll(async () => { await app.close(); });

    it('Allow-Private-Network is not set when request did not opt-in', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST'));
      expect(res.headers.get('access-control-allow-private-network')).toBeNull();
    });
  });

  describe('allowPrivateNetwork default (false) → ignore request header', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', methods: ['POST'] });
    });
    afterAll(async () => { await app.close(); });

    it('does not attach Allow-Private-Network even if requested', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST', {
        'Access-Control-Request-Private-Network': 'true',
      }));
      expect(res.headers.get('access-control-allow-private-network')).toBeNull();
    });
  });
});
