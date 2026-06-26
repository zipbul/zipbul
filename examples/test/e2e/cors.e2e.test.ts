/**
 * End-to-end test for the example application's CORS pipeline.
 *
 * Uses `Test.create` (no `.compile()`, no `preload:`) and the verb-style
 * `HttpClient` from `@zipbul/http-adapter/testing` for supertest-flavor
 * inject calls.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

import { HttpAdapter } from '@zipbul/http-adapter';
import { createHttpClient, type HttpClient } from '@zipbul/http-adapter/testing';
import { Test, type TestApplication } from '@zipbul/testing';

import { appModule } from '../../src/module';
import { TickAdapter } from '../../src/tick/tick';

// CORS + request-timing + tick-audit middleware are declared on appModule
// (see src/module). Test.create compiles the project and applies that
// adapterConfig at startTest, so the test only attaches the transports.
const ALLOWED_ORIGIN = 'https://allowed.example';

describe('examples — CORS e2e', () => {
  let app: TestApplication;
  let http: HttpClient;

  beforeAll(async () => {
    app = await Test.create(appModule, {
      projectRoot: import.meta.dir.replace(/\/test\/e2e$/, ''),
      attach: (recorder) => {
        recorder.attach(HttpAdapter, { port: 0 });
        recorder.attach(TickAdapter, { intervalMs: 60_000 });
      },
    });

    http = createHttpClient(app.adapter(HttpAdapter));
  });

  afterAll(async () => {
    await app.close();
  });

  describe('preflight (OPTIONS)', () => {
    it('responds 204 with Allow-Origin when the origin matches', async () => {
      const res = await http.options('/users', {
        headers: { Origin: ALLOWED_ORIGIN, 'Access-Control-Request-Method': 'GET' },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
    });

    it('does not emit Allow-Origin when the origin does not match', async () => {
      const res = await http.options('/users', {
        headers: { Origin: 'https://blocked.example', 'Access-Control-Request-Method': 'GET' },
      });
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  });

  describe('simple request (GET)', () => {
    it('adds Allow-Origin to a 200 response when the origin matches', async () => {
      const res = await http.get('/users', { headers: { Origin: ALLOWED_ORIGIN } });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });

    it('omits Allow-Origin when no Origin header is sent (same-origin)', async () => {
      const res = await http.get('/users');
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  });
});
