import { describe, expect, it } from 'bun:test';

import { HttpAdapter } from './http-adapter';
import { HttpContext } from './http-context';
import { HttpResponse } from './http-response';
import { createTestHttpRequest } from './test-fixtures/http-request-fixture';
import type { AdapterContext } from '@zipbul/common';

function buildContext(): AdapterContext {
  const req = createTestHttpRequest();
  const res = new HttpResponse(req, new Headers());
  const ctx = new HttpContext(req, res);
  return ctx as unknown as AdapterContext;
}

describe('emergencyTeardown (C5)', () => {
  class TestAdapter extends HttpAdapter {
    public testTeardown(ctx: AdapterContext, err: unknown): void {
      this.emergencyTeardown(ctx, err);
    }
  }

  it('emits generic 500 on plain Error', async () => {
    const ctx = buildContext();
    const adapter = new TestAdapter();
    adapter.testTeardown(ctx, new Error('boom'));
    const http = ctx.to(HttpContext);
    const wire = http.response.end();
    expect(wire.status).toBe(500);
    expect(await wire.text()).toBe('Internal Server Error');
  });

  it('emits generic 500 on undefined error', async () => {
    const ctx = buildContext();
    const adapter = new TestAdapter();
    adapter.testTeardown(ctx, undefined);
    const http = ctx.to(HttpContext);
    const wire = http.response.end();
    expect(wire.status).toBe(500);
  });

  it('skips rewriting if response already sent', async () => {
    const ctx = buildContext();
    const http = ctx.to(HttpContext);
    http.response.setStatus(200);
    http.response.setBody('done');
    http.response.end();
    const adapter = new TestAdapter();
    adapter.testTeardown(ctx, new Error('ignored'));
    const wire = http.response.end();
    expect(wire.status).toBe(200);
  });
});
