import { describe, expect, it } from 'bun:test';

import { HttpHeader } from '@zipbul/http-adapter';

import { bootHelmetApp, setupSilentLogger } from './helpers';

import type { HelmetTestApp } from './helpers';

describe('e2e — X-Content-Type-Options (wire)', () => {
  const apps: HelmetTestApp[] = [];
  setupSilentLogger(apps);

  async function boot(...args: Parameters<typeof bootHelmetApp>) {
    const app = await bootHelmetApp(...args);
    apps.push(app);
    return app;
  }

  it('emits x-content-type-options: nosniff on a normal 200 response', async () => {
    const app = await boot({
      ok: (ctx) => {
        ctx.response.setContentType('text/plain');
        return 'ok-body';
      },
    });
    const res = await app.fetch('/ok');
    expect(res.status).toBe(200);
    expect(res.headers.get(HttpHeader.XContentTypeOptions)).toBe('nosniff');
  });

  it('omits the header on the wire when xContentTypeOptions is false', async () => {
    const app = await boot(
      {
        ok: (ctx) => {
          ctx.response.setContentType('text/plain');
          return 'ok-body';
        },
      },
      { xContentTypeOptions: false },
    );
    const res = await app.fetch('/ok');
    expect(res.headers.get(HttpHeader.XContentTypeOptions)).toBeNull();
  });
});
