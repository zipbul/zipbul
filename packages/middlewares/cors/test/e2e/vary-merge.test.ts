import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { defineMiddleware } from '@zipbul/common';
import { HttpAdapter, HttpContext, HttpAdapterPhase } from '@zipbul/http-adapter';
import { Tck, type TestApplication } from '@zipbul/tck';

import { corsMiddleware } from '../../index';
import { setupSilentLogger, varyTokens } from './helpers';

const stampVary = defineMiddleware([HttpAdapter], () => (ctx) => {
  ctx.to(HttpContext).response.appendHeader('Vary', 'Accept-Encoding');
});

describe('CORS / Vary merge with prior middleware', () => {
  setupSilentLogger();

  let testApp: TestApplication;
  let port: number;

  beforeAll(async () => {
    let captured: HttpAdapter | undefined;
    testApp = await Tck.createApplication({
      register: (app) => {
        const http = app.attach(HttpAdapter, { port: 0 });
        http.addMiddlewares(HttpAdapterPhase.OnRequest, [
          stampVary,
          corsMiddleware({ origin: 'https://x.com' }),
        ]);
        captured = http;
      },
    });
    const server = captured!.getServer();
    if (server === undefined || typeof server.port !== 'number') {
      await testApp.close();
      throw new Error('http server not booted');
    }
    port = server.port;
  });

  afterAll(async () => { await testApp.close(); });

  it('Vary preserves prior token and appends Origin', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/x`, {
      headers: { Origin: 'https://x.com' },
    });
    const tokens = varyTokens(res.headers.get('vary'));
    expect(tokens).toContain('accept-encoding');
    expect(tokens).toContain('origin');
  });
});
