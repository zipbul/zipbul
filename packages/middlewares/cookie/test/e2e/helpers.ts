import { afterAll, beforeAll } from 'bun:test';
import type { MiddlewareDefinition } from '@zipbul/common';
import { HttpAdapter, HttpAdapterPhase } from '@zipbul/http-adapter';
import { Tck, type TestApplication } from '@zipbul/tck';

import type { CookieParserOptions } from '../../index';
import { cookieMiddleware } from '../../index';

export interface CookieTestApp {
  testApp: TestApplication;
  port: number;
  url(path: string): string;
  fetch(path: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

export interface BootCookieAppExtras {
  /** Middlewares registered at OnRequest AFTER the cookie parser (so they can read the jar). */
  onRequest?: MiddlewareDefinition[];
}

/**
 * Boots a real {@link HttpAdapter} (Bun server on an ephemeral port) with the cookie middleware pair
 * registered at their phases, mirroring the cors e2e harness. Downstream `onRequest` middlewares run
 * after the parser, so a test can stage cookies via `ctx.use(cookieJarKey)`; the `beforeResponse`
 * writer flushes them onto the real response.
 */
export async function bootCookieApp(
  options: CookieParserOptions = {},
  extras: BootCookieAppExtras = {},
): Promise<CookieTestApp> {
  let captured: HttpAdapter | undefined;
  const cm = cookieMiddleware(options);

  const testApp = await Tck.createApplication({
    register: (app) => {
      const http = app.attach(HttpAdapter, { port: 0 });
      http.addMiddlewares(HttpAdapterPhase.OnRequest, [cm.onRequest, ...(extras.onRequest ?? [])]);
      http.addMiddlewares(HttpAdapterPhase.BeforeResponse, [cm.beforeResponse]);
      captured = http;
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

  const port = server.port;
  const base = `http://127.0.0.1:${port}`;

  return {
    testApp,
    port,
    url: (path) => `${base}${path}`,
    fetch: (path, init) => fetch(`${base}${path}`, init),
    close: () => testApp.close(),
  };
}

export function setupSilentLogger(): void {
  beforeAll(() => { Tck.silenceLogger(); });
  afterAll(() => { Tck.restoreLogger(); });
}
