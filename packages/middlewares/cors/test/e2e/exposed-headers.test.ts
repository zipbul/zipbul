import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { bootCorsApp, setupSilentLogger, type CorsTestApp } from './helpers';

describe('CORS / exposedHeaders', () => {
  setupSilentLogger();

  describe('explicit list', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: '*', exposedHeaders: ['X-Foo', 'X-Bar'] });
    });
    afterAll(async () => { await app.close(); });

    it('should set Access-Control-Expose-Headers from the configured list', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://x.com' } });
      const expose = String(res.headers.get('access-control-expose-headers')).toLowerCase();
      expect(expose).toContain('x-foo');
      expect(expose).toContain('x-bar');
    });
  });

  describe('wildcard with credentials and explicit entries', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({
        origin: 'https://x.com',
        exposedHeaders: ['*', 'X-Foo'],
        credentials: true,
      });
    });
    afterAll(async () => { await app.close(); });

    it('should drop the wildcard and keep explicit entries in Access-Control-Expose-Headers', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://x.com' } });
      const expose = String(res.headers.get('access-control-expose-headers'));
      expect(expose).not.toContain('*');
      expect(expose.toLowerCase()).toContain('x-foo');
    });
  });

  describe('wildcard without credentials', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: '*', exposedHeaders: ['*'] });
    });
    afterAll(async () => { await app.close(); });

    it('should set Access-Control-Expose-Headers to "*"', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://x.com' } });
      expect(res.headers.get('access-control-expose-headers')).toBe('*');
    });
  });

  describe('explicit empty list', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: '*', exposedHeaders: [] });
    });
    afterAll(async () => { await app.close(); });

    it('should omit Access-Control-Expose-Headers', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://x.com' } });
      expect(res.headers.get('access-control-expose-headers')).toBeNull();
    });
  });

  describe('wildcard with credentials and no explicit entries', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({
        origin: 'https://x.com',
        exposedHeaders: ['*'],
        credentials: true,
      });
    });
    afterAll(async () => { await app.close(); });

    it('should omit Access-Control-Expose-Headers', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://x.com' } });
      expect(res.headers.get('access-control-expose-headers')).toBeNull();
    });
  });
});
