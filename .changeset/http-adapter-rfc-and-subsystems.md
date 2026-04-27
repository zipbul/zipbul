---
"@zipbul/http-adapter": minor
---

HTTP adapter subsystem extraction, RFC 9110 compliance hardening, and Bun native feature absorption.

Subsystem extraction (`src/`): new `proxy/` (cidr, forwarded-parser, trust-proxy, resolve), `body/` (read-with-limit, parse-json, parser), `response-writer/` (write-error, write-success, type-guards), `route-options/` (single-pass `parseDecoratorOptions`, response-defaults), `metadata/`, and `pipeline/` (HEAD-alias dedup in `router-register`). `CoreStep` enum replaces string literals in `adapter-definition.ts`. 33 unused error classes removed (38 → 5 files); `HttpRequest` mutable fields → private + getter/setter; `_status` sentinel `0` → `undefined`.

RFC compliance:
- Error response key unified to `status` (write-error, `httpError`, fallback paths)
- TRACE/CONNECT initially treated as standard methods returning automatic 501 per RFC 9110 §15.6.2 (later refined — see follow-up changesets)
- URI length defense: `maxUriLength` option (default 8192) → 414 (RFC 9110 §15.5.15)
- Negative `Content-Length` rejected (RFC 9110 §8.6)
- `RouteHandler.matchRoute` normalizes the router's `method-not-found` exception to `not-found` so unsupported methods reach the unsupported-method response path
- `@Method` token validation per RFC 9110 §5.1 (rejects empty / whitespace / non-tchar)
- 2-phase registration in `registerFromHandlerIndex` (validate-all → register-all) for atomicity

Bun native absorption:
- Per-request timeout via `HttpContext.setTimeout` (SSE auto-`setTimeout(0)`); `_timeoutRequest` kept independent of `consumeRawRequest`
- TLS SNI: `HttpTlsOptions = TLSOptions | readonly TLSOptions[]`
- Operations metrics public API: `HttpServer.getMetrics()` and `HttpAdapter.getMetrics()`

Bug fixes: `setBody()` now resets `_serialized = false` on entry; stream cancellation goes through `cancelStreamQuietly()` to swallow late rejections.

Tests: new `http-tls-sni-e2e`, `http-proxy-trust-e2e` (4 trustProxy modes × Forwarded/X-Forwarded-*), `http-misc-e2e` (303/307/308 redirects, dangerous-scheme rejection, negative CL via raw TCP, custom maxUriLength, requestId header/generator, graceful drain), plus `dead-branch-proof.test.ts` proving unsupported-method requests are rejected before resolveRoute. Coverage 70% → 96% on affected modules.
