/**
 * `@zipbul/http-adapter/testing` — adapter-owned test fixtures and the
 * `HttpClient` verb sugar (`app.http.get(...)` / `.post(...)` / etc).
 *
 * The subpath ships **source** (not a separate bundle) so the
 * `HttpContext` / `HttpRequest` / `HttpResponse` classes are the same
 * module instances the production HTTP path uses. A separate bundle
 * would inline its own copy and break `ctx.to(HttpContext)` identity
 * checks in middleware factories that import from `@zipbul/http-adapter`.
 *
 * @public
 */

export {
  createTestHttpContext as mockContext,
  createTestHttpRequest as mockRequest,
  createTestHttpResponse as mockResponse,
  unwrapOk,
  unwrapErr,
  readJsonBody,
  assertDefined,
  type HttpJsonErrorBody,
} from './src/test-fixtures';

export type { HttpTestSurface, HttpInjectInput, HttpInjectOptions } from './src/test-surface';

import type { HttpTestSurface, HttpInjectInput, HttpInjectOptions } from './src/test-surface';

// DOM-derived globals (avoid `@types/web` dependency).
type HeadersInit = ConstructorParameters<typeof Headers>[0];
type BodyInit = ConstructorParameters<typeof Response>[0];

/**
 * Per-request init for `HttpClient` verb methods. Mirrors `HttpInjectInput`
 * (minus `method` / `url` which the verb method supplies) and adds:
 *   - `json` — shorthand that JSON-encodes the value and sets
 *     `content-type: application/json`.
 *
 * @public
 */
export interface HttpClientRequestInit {
  headers?: HeadersInit;
  body?: BodyInit | null;
  /** JSON-encode this value and set `content-type: application/json`. */
  json?: unknown;
}

/**
 * Verb-style sugar over {@link HttpTestSurface.inject}. Resolves relative
 * URLs against `http://app.test`. `inject(...)` and the raw `HttpInjectInput`
 * remain available for tests that need full request control.
 *
 * @public
 */
export interface HttpClient extends HttpTestSurface {
  get(url: string, init?: HttpClientRequestInit, options?: HttpInjectOptions): Promise<Response>;
  post(url: string, init?: HttpClientRequestInit, options?: HttpInjectOptions): Promise<Response>;
  put(url: string, init?: HttpClientRequestInit, options?: HttpInjectOptions): Promise<Response>;
  patch(url: string, init?: HttpClientRequestInit, options?: HttpInjectOptions): Promise<Response>;
  delete(url: string, init?: HttpClientRequestInit, options?: HttpInjectOptions): Promise<Response>;
  options(url: string, init?: HttpClientRequestInit, options?: HttpInjectOptions): Promise<Response>;
  head(url: string, init?: HttpClientRequestInit, options?: HttpInjectOptions): Promise<Response>;
}

const VIRTUAL_HOST = 'http://app.test';

function absoluteUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return url.startsWith('/') ? `${VIRTUAL_HOST}${url}` : `${VIRTUAL_HOST}/${url}`;
}

function buildInject(
  surface: HttpTestSurface,
  method: string,
  url: string,
  init?: HttpClientRequestInit,
  options?: HttpInjectOptions,
): Promise<Response> {
  const absolute = absoluteUrl(url);
  const headers = new Headers(init?.headers);
  let body: BodyInit | null | undefined = init?.body ?? null;

  if (init?.json !== undefined) {
    body = JSON.stringify(init.json);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  }

  const input: HttpInjectInput = {
    method,
    url: absolute,
    headers,
    body,
  };
  return surface.inject(input, options);
}

/**
 * Wraps an {@link HttpTestSurface} in a verb-style {@link HttpClient}.
 *
 * @public
 */
export function createHttpClient(surface: HttpTestSurface): HttpClient {
  return {
    inject: (input, options) => surface.inject(input, options),
    get: (url, init, options) => buildInject(surface, 'GET', url, init, options),
    post: (url, init, options) => buildInject(surface, 'POST', url, init, options),
    put: (url, init, options) => buildInject(surface, 'PUT', url, init, options),
    patch: (url, init, options) => buildInject(surface, 'PATCH', url, init, options),
    delete: (url, init, options) => buildInject(surface, 'DELETE', url, init, options),
    options: (url, init, options) => buildInject(surface, 'OPTIONS', url, init, options),
    head: (url, init, options) => buildInject(surface, 'HEAD', url, init, options),
  };
}
