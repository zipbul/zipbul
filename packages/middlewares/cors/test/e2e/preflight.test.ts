import { HttpMethod } from '@zipbul/http-adapter';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';

import { bootCorsApp, preflight, setupSilentLogger, type CorsTestApp } from './helpers';

describe('CORS / preflight', () => {
  setupSilentLogger();

  describe('default optionsSuccessStatus', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', methods: [HttpMethod.Post] });
    });
    afterAll(async () => { await app.close(); });

    it('should respond 204 with an empty body', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST'));
      expect(res.status).toBe(204);
      expect(await res.text()).toBe('');
    });
  });

  describe('custom optionsSuccessStatus = 200', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({
        origin: 'https://x.com',
        methods: [HttpMethod.Post],
        optionsSuccessStatus: 200,
      });
    });
    afterAll(async () => { await app.close(); });

    it('should respond with the configured status code', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST'));
      expect(res.status).toBe(200);
    });
  });

  describe('preflightContinue:true', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({
        origin: 'https://x.com',
        methods: [HttpMethod.Post],
        preflightContinue: true,
      });
    });
    afterAll(async () => { await app.close(); });

    it('should attach preflight headers and let the route run (404 when no route matches)', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST'));
      expect(res.status).toBe(404);
      expect(res.headers.get('access-control-allow-origin')).toBe('https://x.com');
      expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    });
  });

  describe('preflightContinue:true combined with maxAge', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({
        origin: 'https://x.com',
        methods: [HttpMethod.Post],
        maxAge: 3600,
        preflightContinue: true,
      });
    });
    afterAll(async () => { await app.close(); });

    it('should attach Access-Control-Max-Age on the continued response', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST'));
      expect(res.headers.get('access-control-max-age')).toBe('3600');
    });
  });

  describe('preflightContinue:true combined with credentials', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({
        origin: 'https://x.com',
        credentials: true,
        methods: [HttpMethod.Post],
        preflightContinue: true,
      });
    });
    afterAll(async () => { await app.close(); });

    it('should attach Access-Control-Allow-Credentials on the continued response', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST'));
      expect(res.headers.get('access-control-allow-credentials')).toBe('true');
      expect(res.headers.get('access-control-allow-origin')).toBe('https://x.com');
    });
  });

  describe('maxAge: 3600', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', methods: [HttpMethod.Post], maxAge: 3600 });
    });
    afterAll(async () => { await app.close(); });

    it('should set Access-Control-Max-Age to 3600', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST'));
      expect(res.headers.get('access-control-max-age')).toBe('3600');
    });
  });

  describe('maxAge: 0', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', methods: [HttpMethod.Post], maxAge: 0 });
    });
    afterAll(async () => { await app.close(); });

    it('should set Access-Control-Max-Age to "0"', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST'));
      expect(res.headers.get('access-control-max-age')).toBe('0');
    });
  });

  describe('maxAge default (null)', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', methods: [HttpMethod.Post] });
    });
    afterAll(async () => { await app.close(); });

    it('should omit Access-Control-Max-Age', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST'));
      expect(res.headers.get('access-control-max-age')).toBeNull();
    });
  });

  describe('OPTIONS without Access-Control-Request-Method', () => {
    let app: CorsTestApp;
    beforeAll(async () => { app = await bootCorsApp({ origin: '*' }); });
    afterAll(async () => { await app.close(); });

    it('should treat the request as a simple request and skip preflight headers', async () => {
      const res = await app.fetch('/x', {
        method: HttpMethod.Options,
        headers: { Origin: 'https://x.com' },
      });
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('access-control-allow-methods')).toBeNull();
    });
  });

  describe('preflight response body', () => {
    let app: CorsTestApp;
    beforeAll(async () => {
      app = await bootCorsApp({ origin: 'https://x.com', methods: [HttpMethod.Post] });
    });
    afterAll(async () => { await app.close(); });

    it('should return an empty body with no Content-Type and Content-Length: 0', async () => {
      const res = await app.fetch('/x', preflight('https://x.com', 'POST'));
      expect(await res.text()).toBe('');
      expect(res.headers.get('content-type')).toBeNull();
      expect(res.headers.get('content-length')).toBe('0');
    });
  });
});
