import { afterAll, beforeAll } from 'bun:test';
import type { MiddlewareDefinition } from '@zipbul/common';
import { HttpAdapter, HttpAdapterPhase, HttpMethod } from '@zipbul/http-adapter';
import { Tck, type TestApplication } from '@zipbul/tck';

import { corsMiddleware } from '../../index';
import type { CorsOptions } from '../../index';

export interface CorsTestApp {
  testApp: TestApplication;
  port: number;
  url(path: string): string;
  fetch(path: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

export interface BootCorsAppExtras {
  priorMiddlewares?: MiddlewareDefinition[];
}

export async function bootCorsApp(opts: CorsOptions, extras: BootCorsAppExtras = {}): Promise<CorsTestApp> {
  let captured: HttpAdapter | undefined;

  const testApp = await Tck.createApplication({
    adapterConfig: {
      HttpAdapter: {
        middlewares: {
          [HttpAdapterPhase.OnRequest]: [
            ...(extras.priorMiddlewares ?? []),
            corsMiddleware(opts),
          ],
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

export function varyTokens(header: string | null): string[] {
  if (header === null) {
    return [];
  }
  return header.split(',').map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0);
}

export function setupSilentLogger(): void {
  beforeAll(() => { Tck.silenceLogger(); });
  afterAll(() => { Tck.restoreLogger(); });
}

export function preflight(
  origin: string,
  method: string,
  extra?: Record<string, string>,
): RequestInit {
  return {
    method: HttpMethod.Options,
    headers: { Origin: origin, 'Access-Control-Request-Method': method, ...extra },
  };
}
