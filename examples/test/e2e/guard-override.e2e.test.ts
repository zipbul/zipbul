/**
 * End-to-end test for the `.overrideGuard(...)` typed sugar.
 *
 * The example app's `UsersController.delete` is annotated with
 * `@UseGuards(authGuard)`. The real `authGuard` rejects requests without
 * a session cookie (`session=42`). This test installs a stub guard that
 * always passes — proving the toolkit:
 *   1. Found the handler entry via (controller class, method name).
 *   2. Replaced every container key the AOT compiler emitted for that
 *      handler's guard list.
 *   3. Did so WITHOUT the toolkit knowing the `__route_gd__:...` key
 *      format (the format is an internal CLI / runtime contract).
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

describe('examples — .overrideGuard typed sugar (handlerIndex-driven, no key-format coupling)', () => {
  let app: TestApplication;
  let http: HttpTestSurface;

  beforeAll(async () => {
    app = await Test.createApplication({
      module: appModule,
      preload: () => import(`../../.zipbul-temp/runtime.ts`),
      attach: (recorder) => {
        const httpAdapter = recorder.attach(HttpAdapter, { port: 0 });
        httpAdapter.addMiddlewares(HttpAdapterPhase.OnRequest, [
          corsMiddleware({ origin: ALLOWED_ORIGIN }),
          requestTimingMiddleware(),
        ]);
        const tick = recorder.attach(TickAdapter, { intervalMs: 60_000 });
        tick.addMiddlewares(TickPhase.OnTick, [tickAuditMiddleware]);
      },
    })
      .overrideGuard(UsersController, 'delete', passThroughGuard)
      .compile();

    http = app.adapter(HttpAdapter);
  });

  afterAll(async () => {
    await app.close();
  });

  it('DELETE /users/:id passes the overridden guard (no session cookie required)', async () => {
    const res = await http.inject({
      method: 'DELETE',
      url: 'http://localhost/users/1',
      headers: {
        Origin: ALLOWED_ORIGIN,
      },
    });

    // Real authGuard would reject with 401; the pass-through guard lets
    // the request through and the controller's delete handler runs.
    expect(res.status).not.toBe(401);
  });
});
