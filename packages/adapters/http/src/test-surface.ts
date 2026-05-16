import type { Server } from 'bun';

import type { HttpServer } from './http-server';

/**
 * `Request`-like input accepted by {@link HttpTestSurface.inject}.
 *
 * Allows tests to pass either a full WHATWG {@link Request} or a small
 * object literal that the toolkit normalizes into a `Request` before
 * driving the production `fetch()` path.
 *
 * @public
 */
export interface HttpInjectInput {
  method?: string;
  url: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
}

// Re-declare DOM-derived globals to avoid `@types/web` dependency.
type HeadersInit = ConstructorParameters<typeof Headers>[0];
type BodyInit = ConstructorParameters<typeof Response>[0];

/**
 * Test surface contract for {@link HttpAdapter} — returned by the adapter's
 * `[Symbol.for('@zipbul/testing/surface')]()` method.
 *
 * @public
 */
export interface HttpTestSurface {
  /**
   * Drive a request through the production HTTP path without binding a
   * network socket. The `Request → Response` flow exercises route
   * resolution, body parsing, guards, middleware, handler dispatch,
   * exception filters, and serialization — exactly as `Bun.serve` would.
   *
   * @public
   */
  inject(input: Request | HttpInjectInput): Promise<Response>;
}

/**
 * Concrete `HttpTestSurface` backed by an already-prepared `HttpServer`.
 *
 * @internal
 */
export function createHttpInjectSurface(
  httpServer: HttpServer,
  stubServer: Server<unknown>,
): HttpTestSurface {
  return {
    async inject(input) {
      const request = input instanceof Request
        ? input
        : new Request(input.url, {
          method: input.method ?? 'GET',
          ...(input.headers !== undefined ? { headers: input.headers } : {}),
          ...(input.body !== undefined ? { body: input.body } : {}),
        });
      return await httpServer.fetch(request, stubServer);
    },
  };
}
