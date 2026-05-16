import { HttpContext } from '../http-context';
import { HttpResponse } from '../http-response';
import { createTestHttpRequest } from './http-request-fixture';
import type { HttpRequestData } from '../interfaces';

/**
 * Full request-scoped context for tests. Returns the concrete
 * {@link HttpContext} class along with a matching raw `Request`, so
 * middlewares that read `ctx.rawRequest` (CORS, cookie parsers, body
 * readers) behave as they would under a real `Bun.serve` dispatch.
 *
 * The raw `Request` mirrors the `HttpRequest`'s url / method / headers.
 * Pass any of those fields via `requestOverrides` to shape both.
 */
export function createTestHttpContext(
  requestOverrides: Partial<HttpRequestData> = {},
): HttpContext {
  const req = createTestHttpRequest(requestOverrides);
  const res = new HttpResponse(req, new Headers());
  const rawRequest = new Request(req.url, { method: req.method, headers: req.headers });
  return new HttpContext(req, res, rawRequest);
}
