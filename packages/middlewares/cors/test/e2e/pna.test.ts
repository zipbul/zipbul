import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { bootCorsApp, preflight, setupSilentLogger, type CorsTestApp } from './helpers';

describe('CORS / privateNetworkAccess', () => {
  setupSilentLogger();

  describe('allowPrivateNetwork:true with Access-Control-Request-Private-Network:true', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({
        origin: 'https://x.com',
        methods: ['POST'],
        allowPrivateNetwork: true,
      });
    });
    afterAll(async () => { await app.close(); });

    it('should set Access-Control-Allow-Private-Network:true on preflight', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST', {
        'Access-Control-Request-Private-Network': 'true',
      }));
      expect(res.headers.get('access-control-allow-private-network')).toBe('true');
    });
  });

  describe('allowPrivateNetwork:true with no Access-Control-Request-Private-Network header', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({
        origin: 'https://x.com',
        methods: ['POST'],
        allowPrivateNetwork: true,
      });
    });
    afterAll(async () => { await app.close(); });

    it('should omit Access-Control-Allow-Private-Network', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST'));
      expect(res.headers.get('access-control-allow-private-network')).toBeNull();
    });
  });

  describe('allowPrivateNetwork default (false) with Access-Control-Request-Private-Network:true', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', methods: ['POST'] });
    });
    afterAll(async () => { await app.close(); });

    it('should ignore the request header and omit Access-Control-Allow-Private-Network', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST', {
        'Access-Control-Request-Private-Network': 'true',
      }));
      expect(res.headers.get('access-control-allow-private-network')).toBeNull();
    });
  });

  describe('allowPrivateNetwork:true combined with preflightContinue:true', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({
        origin: 'https://x.com',
        methods: ['POST'],
        allowPrivateNetwork: true,
        preflightContinue: true,
      });
    });
    afterAll(async () => { await app.close(); });

    it('should attach Access-Control-Allow-Private-Network on the continued response', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST', {
        'Access-Control-Request-Private-Network': 'true',
      }));
      expect(res.headers.get('access-control-allow-private-network')).toBe('true');
    });
  });
});
