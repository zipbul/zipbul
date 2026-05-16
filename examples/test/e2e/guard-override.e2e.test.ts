/**
 * End-to-end test for the `di.guard(...).use(...)` typed override sugar.
 *
 * The example app's `UsersController.delete` is annotated with
 * `@UseGuards(authGuard)`. The real `authGuard` rejects requests without
 * a session cookie. This test installs a stub guard that always passes,
 * proving the toolkit walks `handlerIndex.mergedGuardKeys` for the
 * matching handler and replaces every AOT-emitted container key with
 * the override — without the toolkit knowing the key format.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

import { defineGuard } from '@zipbul/common';
import { corsMiddleware } from '@zipbul/cors';
import { HttpAdapter, HttpAdapterPhase, type HttpTestSurface } from '@zipbul/http-adapter';
import { Test, type TestApplication } from '@zipbul/testing';

import { requestTimingMiddleware } from '../../src/middleware/request-timing.middleware';
import { UsersController } from '../../src/users/users.controller';
import { appModule } from '../../src/module';
import { TickAdapter, TickPhase } from '../../src/tick/tick';
import { tickAuditMiddleware } from '../../src/tick/tick.middleware';

const ALLOWED_ORIGIN = 'https://allowed.example';
const passThroughGuard = defineGuard(() => () => undefined);

describe('examples — di.guard(...).use(...) typed override (handlerIndex-driven)', () => {
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
      override: (di) => {
        di.guard(UsersController, 'delete').use(passThroughGuard);
      },
    });

    http = app.adapter(HttpAdapter);
  });

  afterAll(async () => {
    await app.close();
  });

  it('DELETE /users/1 passes the overridden guard (no session cookie required)', async () => {
    const res = await http.inject({
      method: 'DELETE',
      url: 'http://localhost/users/1',
      headers: { Origin: ALLOWED_ORIGIN },
    });
    expect(res.status).not.toBe(401);
  });
});
