import { HttpResponse } from '../http-response';
import { createTestHttpRequest } from './http-request-fixture';
import type { HttpRequestData } from '../types';

/**
 * Creates a real {@link HttpResponse} bound to a test {@link HttpRequest}.
 * Pair with {@link createTestHttpRequest} overrides to shape the request side.
 */
export function createTestHttpResponse(
  requestOverrides: Partial<HttpRequestData> = {},
  headers: Headers = new Headers(),
): HttpResponse {
  return new HttpResponse(createTestHttpRequest(requestOverrides), headers);
}
