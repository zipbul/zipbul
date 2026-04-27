---
"@zipbul/http-adapter": minor
---

Removed the server-wide `allowedMethods` set and the 501 fast path. Unknown methods now uniformly resolve to `405 + Allow` (path exists) or `404` (no path), matching modern JS framework conventions (Express / Fastify / NestJS / Hono / Elysia) and RFC 9110 §15.5.6 (which makes `Allow` a `MUST` for 405) while skipping the §15.6.2 501 (a `SHOULD NOT` for "merely unwilling" cases).

Removed:
- `HttpServer.allowedMethods` field and the boot-time cache assignment
- `validateHttpMethod()` helper, the `'not-implemented'` `CreateHttpRequestOutput` variant, and the `pipelineError` 501 branch (`createHttpRequest` no longer takes `allowedMethods`)
- `RouteHandler.allowedMethods` set and `getServerAllowedMethods()`

Behavior change: requests with an unknown method (including TRACE/CONNECT received over the wire — note that `@Method` handlers for those tokens are still rejected at boot) now return `404` if the path is unregistered, or `405` with `Allow` if the path exists with other methods. There is no automatic 501 path anymore. The `@Method` scan still validates the RFC 9110 §5.1 token and rejects `FORBIDDEN_HTTP_METHODS` (TRACE/CONNECT).
