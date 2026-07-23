import { beforeAll, describe, expect, it } from 'bun:test';

import { defineMiddleware } from '@zipbul/common';
import { HttpAdapter, HttpContext, HttpHeader, HttpStatus } from '@zipbul/http-adapter';

import { bootHelmetApp, setupSilentLogger } from './helpers';

import type { HelmetTestApp } from './helpers';

/**
 * Every helmet header, with its default value, asserted on every shape — no
 * representative-header inference. `build()`'s body-drop branches strip only
 * representation/content-coupled headers (content-type, -length, -encoding,
 * digests); they never touch an exchange header, so each of these must survive
 * every branch directly.
 */
const DEFAULT_HEADERS: ReadonlyArray<readonly [name: string, value: string]> = [
  [HttpHeader.ReferrerPolicy, 'no-referrer'],
  [HttpHeader.XContentTypeOptions, 'nosniff'],
];

function expectHeadersSurvive(res: Response): void {
  for (const [name, value] of DEFAULT_HEADERS) {
    expect(res.headers.get(name)).toBe(value);
  }
}

/**
 * §5 response-shape taxonomy × every helmet header survival — this layer's own
 * contract, not covered by integration. Each shape exercises a different
 * `HttpResponse.build()` branch (body-drop rules differ per branch —
 * no-content/not-modified/head are each a distinct branch), and none of them
 * strip an exchange header like these — only representation/content-coupled ones.
 */
describe('e2e — pipeline (response-shape survival)', () => {
  const apps: HelmetTestApp[] = [];
  setupSilentLogger(apps);

  async function boot(...args: Parameters<typeof bootHelmetApp>) {
    const app = await bootHelmetApp(...args);
    apps.push(app);
    return app;
  }

  let normalApp: HelmetTestApp;
  beforeAll(async () => {
    normalApp = await boot({
      ok: (ctx) => {
        ctx.response.setContentType('text/plain');
        return 'ok-body';
      },
      noContent: (ctx) => {
        ctx.response.setStatus(HttpStatus.NoContent);
        return undefined;
      },
      notModified: (ctx) => {
        ctx.response.setStatus(HttpStatus.NotModified);
        return undefined;
      },
      redirect: (ctx) => {
        ctx.response.redirect('/elsewhere', HttpStatus.Found);
        return undefined;
      },
    });
  });

  it('ok — a real handler response (200) carries the header', async () => {
    const res = await normalApp.fetch('/ok');
    expect(res.status).toBe(200);
    expectHeadersSurvive(res);
  });

  it('head — HEAD strips the body but keeps the header', async () => {
    const res = await normalApp.fetch('/ok', { method: 'HEAD' });
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.byteLength).toBe(0);
    expectHeadersSurvive(res);
  });

  it('no-content — 204 drops representation metadata but keeps the header', async () => {
    const res = await normalApp.fetch('/noContent');
    expect(res.status).toBe(204);
    expectHeadersSurvive(res);
  });

  it('not-modified — 304 keeps the header', async () => {
    const res = await normalApp.fetch('/notModified');
    expect(res.status).toBe(304);
    expectHeadersSurvive(res);
  });

  it('redirect — 302 drops the body but keeps the header', async () => {
    const res = await normalApp.fetch('/redirect', { redirect: 'manual' });
    expect(res.status).toBe(302);
    expectHeadersSurvive(res);
  });

  it('none — an unmatched route (404) still ran OnRequest, keeps the header', async () => {
    const res = await normalApp.fetch('/does-not-exist');
    expect(res.status).toBe(404);
    expectHeadersSurvive(res);
  });

  describe('error-status — a committed OnRequest response keeps the header', () => {
    let app: HelmetTestApp;
    beforeAll(async () => {
      const errorStatusMw = defineMiddleware([HttpAdapter], () => (ctx) => {
        const { response } = ctx.to(HttpContext);
        response.setStatus(HttpStatus.InternalServerError);
        response.setContentType('text/plain');
        response.setBody('err');
        response.send();
      });
      app = await boot({}, undefined, { subsequent: [errorStatusMw] });
    });

    it('keeps the header on a committed 500 (send() short-circuits, no teardown)', async () => {
      const res = await app.fetch('/anything');
      expect(res.status).toBe(500);
      expectHeadersSurvive(res);
    });
  });

  describe('throw — a helmet-rear OnRequest throw goes through emergencyTeardown', () => {
    let app: HelmetTestApp;
    beforeAll(async () => {
      const throwMw = defineMiddleware([HttpAdapter], () => () => {
        throw new Error('boom');
      });
      app = await boot({}, undefined, { subsequent: [throwMw] });
    });

    it('keeps the header after emergencyTeardown replaces the representation', async () => {
      const res = await app.fetch('/anything');
      expect(res.status).toBe(500);
      expectHeadersSurvive(res);
    });
  });
});
