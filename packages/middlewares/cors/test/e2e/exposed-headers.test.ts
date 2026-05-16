import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { bootCorsApp, setupSilentLogger, type CorsTestApp } from './helpers';

describe('CORS / exposedHeaders', () => {
  setupSilentLogger();

  describe('exposedHeaders explicit', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: '*', exposedHeaders: ['X-Foo', 'X-Bar'] });
    });
    afterAll(async () => { await app.close(); });

    it('sets Access-Control-Expose-Headers from list', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://x.com' } });
      const expose = (res.headers.get('access-control-expose-headers') ?? '').toLowerCase();
      expect(expose).toContain('x-foo');
      expect(expose).toContain('x-bar');
    });
  });

  describe('exposedHeaders wildcard + credentials with explicit → wildcard removed, explicit kept', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({
        origin: 'https://x.com',
        exposedHeaders: ['*', 'X-Foo'],
        credentials: true,
      });
    });
    afterAll(async () => { await app.close(); });

    it('omits "*" and keeps explicit headers', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://x.com' } });
      const expose = res.headers.get('access-control-expose-headers') ?? '';
      expect(expose).not.toContain('*');
      expect(expose.toLowerCase()).toContain('x-foo');
    });
  });

  describe('exposedHeaders wildcard without credentials → "*"', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: '*', exposedHeaders: ['*'] });
    });
    afterAll(async () => { await app.close(); });

    it('Expose-Headers is "*"', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://x.com' } });
      expect(res.headers.get('access-control-expose-headers')).toBe('*');
    });
  });

  describe('exposedHeaders: [] explicit empty → header omitted', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: '*', exposedHeaders: [] });
    });
    afterAll(async () => { await app.close(); });

    it('Access-Control-Expose-Headers is not attached', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://x.com' } });
      expect(res.headers.get('access-control-expose-headers')).toBeNull();
    });
  });

  describe('exposedHeaders wildcard + credentials with no explicit → header omitted', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({
        origin: 'https://x.com',
        exposedHeaders: ['*'],
        credentials: true,
      });
    });
    afterAll(async () => { await app.close(); });

    it('Access-Control-Expose-Headers is not attached', async () => {
      const res = await app.fetch('/x', { headers: { Origin: 'https://x.com' } });
      expect(res.headers.get('access-control-expose-headers')).toBeNull();
    });
  });
});
