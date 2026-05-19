import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { bootCorsApp, setupSilentLogger, varyTokens, type CorsTestApp } from './helpers';

describe('CORS / credentials', () => {
  setupSilentLogger();

  describe('credentials:true with a matched string origin', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', credentials: true });
    });
    afterAll(async () => { await app.close(); });

    it('should set Access-Control-Allow-Credentials, echo Origin, and append Vary: Origin', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://x.com' } });
      expect(res.headers.get('access-control-allow-credentials')).toBe('true');
      expect(res.headers.get('access-control-allow-origin')).toBe('https://x.com');
      expect(varyTokens(res.headers.get('vary'))).toContain('origin');
    });
  });

  describe('credentials default (false) with wildcard origin', () => {
    let app: CorsTestApp;
    beforeAll(async () => { app = await bootCorsApp({ origin: '*' }); });
    afterAll(async () => { await app.close(); });

    it('should not set Access-Control-Allow-Credentials', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://x.com' } });
      expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    });
  });

  describe('credentials:true with a RegExp origin', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: /\.example\.com$/, credentials: true });
    });
    afterAll(async () => { await app.close(); });

    it('should set Access-Control-Allow-Credentials when the RegExp matches', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://api.example.com' } });
      expect(res.headers.get('access-control-allow-credentials')).toBe('true');
      expect(res.headers.get('access-control-allow-origin')).toBe('https://api.example.com');
    });
  });

  describe('credentials:true with an async function origin', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({
        origin: async (origin) => {
          await Promise.resolve();
          return origin === 'https://fn.com';
        },
        credentials: true,
      });
    });
    afterAll(async () => { await app.close(); });

    it('should set Access-Control-Allow-Credentials when the function approves the origin', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://fn.com' } });
      expect(res.headers.get('access-control-allow-credentials')).toBe('true');
      expect(res.headers.get('access-control-allow-origin')).toBe('https://fn.com');
    });
  });
});
