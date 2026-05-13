import { HttpRequest } from '../http-request';
import { HttpMethod } from '../enums';
import type { HttpRequestData } from '../interfaces';

/**
 * Shared, strictly-typed fixture for {@link HttpRequest} instances in tests.
 *
 * Design constraints:
 * - Returns a real `HttpRequest` instance, never a plain-object stub.
 *   Tests that need lazy getters (`protocol`, `host`, `hostname`, `port`,
 *   `queryString`, `contentType`) get the real class behaviour — no
 *   `as unknown as HttpRequest` casts needed at call sites.
 * - Accepts `Partial<HttpRequestData>` — the typed constructor shape. Test
 *   code overriding derived fields (e.g. `contentType: ContentTypeInfo`)
 *   should override the corresponding raw input field (e.g. the
 *   `Content-Type` header) so the getter resolves naturally.
 *
 * This fixture is the **single source of truth** for test-side HttpRequest
 * construction. Do not duplicate its shape inline — regressions to the
 * `HttpRequestData` interface must break this file, not silently diverge.
 */
export function createTestHttpRequest(overrides: Partial<HttpRequestData> = {}): HttpRequest {
  const method: HttpMethod = overrides.method ?? HttpMethod.Get;
  const url = overrides.url ?? 'http://localhost/';
  return new HttpRequest({
    requestId: 'test-id',
    originalMethod: method,
    originalUrl: url,
    method,
    url,
    path: '/',
    headers: new Headers(),
    origin: { urlProtocol: 'http', urlHost: 'localhost' },
    contentLength: null,
    ip: null,
    ips: [],
    isTrustedProxy: false,
    signal: AbortSignal.timeout(5000),
    ...overrides,
  });
}
