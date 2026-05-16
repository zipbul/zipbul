/**
 * End-to-end test for the example application's CORS pipeline.
 *
 * The test does NOT modify `src/main.ts`. It mirrors `main.ts`'s wiring
 * inside `Test.createApplication`'s `attach` callback and uses
 * `preload: () => import('../../.zipbul-temp/runtime.ts')` to reuse the
 * AOT-emitted controller / service / handler-index registry produced
 * by `bun run build`. The `.zipbul-temp/runtime.ts` source is used
 * (not `dist/runtime.js`) because the bundled artifact inlines a separate
 * copy of `@zipbul/core` and the `bootstrap-state` singleton would not be
 * shared with the test runner's import of the same package.
 *
 * Pre-requisite: `cd examples && bun run build` must have run at least once
 * so `.zipbul-temp/runtime.ts` is up-to-date.
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
    app = await Test.createApplication({
      module: appModule,
      // Dynamic-string import keeps the generated `.zipbul-temp/runtime.ts`
      // out of TypeScript's type-check graph (it ships without
      // `// @ts-nocheck` and has a few unsafe-cast call sites). The runtime
      // is purely procedural — its side effect of calling
      // `registerBootstrapState({container, ...})` is all the test needs.
      preload: () => import(`../../.zipbul-temp/runtime.ts`),
      attach: (recorder) => {
        const httpAdapter = recorder.attach(HttpAdapter, { port: 0 });
        httpAdapter.addMiddlewares(HttpAdapterPhase.OnRequest, [
          corsMiddleware({ origin: ALLOWED_ORIGIN }),
          requestTimingMiddleware(),
        ]);

        // Tick interval is bumped up so the timer never fires during the test.
        const tick = recorder.attach(TickAdapter, { intervalMs: 60_000 });
        tick.addMiddlewares(TickPhase.OnTick, [tickAuditMiddleware]);
      },
    }).compile();

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
        headers: {
          Origin: ALLOWED_ORIGIN,
          'Access-Control-Request-Method': 'GET',
        },
      });

      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
    });

    it('does not emit Allow-Origin when the origin does not match', async () => {
      const res = await http.inject({
        method: 'OPTIONS',
        url: 'http://localhost/users',
        headers: {
          Origin: 'https://blocked.example',
          'Access-Control-Request-Method': 'GET',
        },
      });

      // CorsAction.Reject path: the middleware returns control with no
      // Allow-Origin header set. The route still resolves and OPTIONS is
      // not a registered method on /users, so the router decides the final
      // status — what matters here is that the allow-origin header is absent.
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  });

  describe('simple request (GET)', () => {
    it('adds Allow-Origin to a 200 response when the origin matches', async () => {
      const res = await http.inject({
        method: 'GET',
        url: 'http://localhost/users',
        headers: {
          Origin: ALLOWED_ORIGIN,
        },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);

      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });

    it('omits Allow-Origin when no Origin header is sent (same-origin)', async () => {
      const res = await http.inject({
        method: 'GET',
        url: 'http://localhost/users',
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  });
});
