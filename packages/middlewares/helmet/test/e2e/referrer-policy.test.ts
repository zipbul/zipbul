import { describe, expect, it } from 'bun:test';

import { HttpHeader } from '@zipbul/http-adapter';

import { bootHelmetApp, setupSilentLogger } from './helpers';

import type { HelmetTestApp } from './helpers';

describe('e2e — Referrer-Policy (wire)', () => {
  const apps: HelmetTestApp[] = [];
  setupSilentLogger(apps);

  async function boot(...args: Parameters<typeof bootHelmetApp>) {
    const app = await bootHelmetApp(...args);
    apps.push(app);
    return app;
  }

  it('emits referrer-policy: no-referrer on a normal 200 response', async () => {
    const app = await boot({
      ok: (ctx) => {
        ctx.response.setContentType('text/plain');
        return 'ok-body';
      },
    });
    const res = await app.fetch('/ok');
    expect(res.status).toBe(200);
    expect(res.headers.get(HttpHeader.ReferrerPolicy)).toBe('no-referrer');
  });

  it('omits the header on the wire when referrerPolicy is false', async () => {
    const app = await boot(
      {
        ok: (ctx) => {
          ctx.response.setContentType('text/plain');
          return 'ok-body';
        },
      },
      { referrerPolicy: false },
    );
    const res = await app.fetch('/ok');
    expect(res.headers.get(HttpHeader.ReferrerPolicy)).toBeNull();
  });
});
