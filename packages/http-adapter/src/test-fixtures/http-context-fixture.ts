import { HttpContext } from '../http-context';
import { HttpResponse } from '../http-response';
import { createTestHttpRequest } from './http-request-fixture';
import type { HttpRequestData } from '../interfaces';

/**
 * Full request-scoped context for tests. Returns the concrete
 * {@link HttpContext} class — no `Context` wider-typed aliasing, no
 * `as unknown as` casts, no plain-object stubs.
 */
export function createTestHttpContext(
  requestOverrides: Partial<HttpRequestData> = {},
): HttpContext {
  const req = createTestHttpRequest(requestOverrides);
  const res = new HttpResponse(req, new Headers());
  return new HttpContext(req, res);
}
