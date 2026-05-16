/**
 * End-to-end test for the example application's CORS pipeline.
 *
 * Uses `Test.create` — the toolkit invokes the AOT compiler in-process
 * if needed (no `zb build` precondition). The `attach` callback mirrors
 * `main.ts`'s production wiring so the test exercises the exact
 * production fetch path. No `preload`, no `.compile()`, no manual
 * `runtime.ts` import.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

import { corsMiddleware } from '@zipbul/cors';
import { HttpAdapter, HttpAdapterPhase, type HttpTestSurface } from '@zipbul/http-adapter';
import { Test, type TestApplication } from '@zipbul/testing';

import { requestTimingMiddleware } from '../../src/middleware/request-timing.middleware';
import { appModule } from '../../src/module';
import { TickAdapter, TickPhase } from '../../src/tick/tick';
import { tickAuditMiddleware } from '../../src/tick/tick.middleware';

const ALLOWED_ORIGIN = 'https://allowed.example';

describe('examples — CORS e2e (in-process inject through production fetch path)', () => {
  let app: TestApplication;
  let http: HttpTestSurface;

  beforeAll(async () => {
    app = await Test.create(appModule, {
      projectRoot: import.meta.dir.replace(/\/test\/e2e$/, ''),
      attach: (recorder) => {
        const httpAdapter = recorder.attach(HttpAdapter, { port: 0 });
        httpAdapter.addMiddlewares(HttpAdapterPhase.OnRequest, [
          corsMiddleware({ origin: ALLOWED_ORIGIN }),
          requestTimingMiddleware(),
        ]);
        const tick = recorder.attach(TickAdapter, { intervalMs: 60_000 });
        tick.addMiddlewares(TickPhase.OnTick, [tickAuditMiddleware]);
      },
    });

    http = app.adapter(HttpAdapter);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('preflight (OPTIONS)', () => {
    it('responds 204 with Allow-Origin when the origin matches', async () => {
      const res = await http.inject({
        method: 'OPTIONS',
        url: 'http://localhost/users',
        headers: { Origin: ALLOWED_ORIGIN, 'Access-Control-Request-Method': 'GET' },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
    });

    it('does not emit Allow-Origin when the origin does not match', async () => {
      const res = await http.inject({
        method: 'OPTIONS',
        url: 'http://localhost/users',
        headers: { Origin: 'https://blocked.example', 'Access-Control-Request-Method': 'GET' },
      });
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  });

  describe('simple request (GET)', () => {
    it('adds Allow-Origin to a 200 response when the origin matches', async () => {
      const res = await http.inject({
        method: 'GET',
        url: 'http://localhost/users',
        headers: { Origin: ALLOWED_ORIGIN },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });

    it('omits Allow-Origin when no Origin header is sent (same-origin)', async () => {
      const res = await http.inject({ method: 'GET', url: 'http://localhost/users' });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  });
});
