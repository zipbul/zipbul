import type { Class } from '@zipbul/common';

import { afterAll, beforeAll } from 'bun:test';
import { defineMiddleware } from '@zipbul/common';
import { HttpAdapter, HttpAdapterPhase, HttpContext } from '@zipbul/http-adapter';
import { Tck, type TestApplication } from '@zipbul/tck';

import { queryParser } from '../../index';

class QueryDto {}

/**
 * Echoes the parsed query — read via the typed `request.getQuery(dto)` accessor
 * the `queryParser` middleware installs — into the `x-parsed-query` response
 * header (JSON-encoded, so any control characters are escaped and never reach
 * the wire raw), then commits the response. Lets an HTTP-level test observe what
 * the middleware parsed without needing an AOT-compiled route.
 */
const echoQuery = defineMiddleware([HttpAdapter], () => (ctx) => {
  const http = ctx.to(HttpContext);
  const query = (http.request as unknown as { getQuery<T>(dto: Class<T>): T }).getQuery(QueryDto);

  http.response.setHeader('x-parsed-query', JSON.stringify(query));
  http.response.send();
});

export interface QpTestApp {
  testApp: TestApplication;
  fetch(path: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

export async function bootQueryParserApp(): Promise<QpTestApp> {
  let captured: HttpAdapter | undefined;

  const testApp = await Tck.createApplication({
    adapterConfig: {
      HttpAdapter: {
        middlewares: {
          [HttpAdapterPhase.OnRequest]: [queryParser, echoQuery],
        },
      },
    },
    register: (app) => {
      captured = app.attach(HttpAdapter, { port: 0 });
    },
  });

  if (captured === undefined) {
    await testApp.close();
    throw new Error('register did not attach HttpAdapter');
  }

  const server = captured.getServer();

  if (server === undefined || typeof server.port !== 'number') {
    await testApp.close();
    throw new Error('http server not booted');
  }

  const base = `http://127.0.0.1:${server.port}`;

  return {
    testApp,
    fetch: (path, init) => fetch(`${base}${path}`, init),
    close: () => testApp.close(),
  };
}

/** Reads the echoed parsed query back from the `x-parsed-query` header. */
export function parsedQuery(res: Response): unknown {
  const header = res.headers.get('x-parsed-query');

  return header === null ? undefined : JSON.parse(header);
}

export function silentLogger(): void {
  beforeAll(() => { Tck.silenceLogger(); });
  afterAll(() => { Tck.restoreLogger(); });
}
