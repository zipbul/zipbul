import { afterAll, describe, expect, it } from 'bun:test';
import { defineMiddleware } from '@zipbul/common';
import { HttpAdapter, HttpContext, HttpAdapterPhase } from '@zipbul/http-adapter';

import { Tck, type TestApplication } from '../../index';

const stampMw = defineMiddleware([HttpAdapter], () => (ctx) => {
  const http = ctx.to(HttpContext);
  http.response.setHeader('x-tck-stamp', 'ok');
});

describe('Tck.createApplication PoC', () => {
  let testApp: TestApplication | undefined;
  let httpAdapter: HttpAdapter | undefined;

  afterAll(async () => {
    await testApp?.close();
  });

  it('boots, listens on dynamic port, and OnRequest header survives 404', async () => {
    testApp = await Tck.createApplication({
      register: (app) => {
        httpAdapter = app.attach(HttpAdapter, { port: 0 });
        httpAdapter.addMiddlewares(HttpAdapterPhase.OnRequest, [stampMw]);
      },
    });

    const server = httpAdapter!.getServer();
    expect(server).toBeDefined();
    const port = server!.port;
    expect(typeof port).toBe('number');
    expect(port).toBeGreaterThan(0);

    const res = await fetch(`http://127.0.0.1:${port}/anywhere`);
    expect(res.status).toBe(404);
    expect(res.headers.get('x-tck-stamp')).toBe('ok');
  });

  it('close is idempotent', async () => {
    await testApp!.close();
    await testApp!.close();
  });
});
