---
"@zipbul/http-adapter": minor
---

Removed `HttpServerOptions.customMethods` — the `@Method('PURGE', '/path')` decorator is now the single source of truth.

The double-declaration trap (where `@Method('PURGE', ...)` would fail boot unless `'PURGE'` was also listed in `customMethods`) is eliminated. The boot-time handler-index scan automatically discovers the methods used by `@Method` decorators and adds them to the allowed set; users no longer pass any method allowlist.

Removed:
- `HttpServerOptions.customMethods` field
- `SafeCustomMethods<T>` utility type
- `HttpServer` customMethods normalization block
- Forbidden runtime check in `http-server.ts` (consolidated into route-handler scan)

`RouteHandler` constructor no longer takes an `allowedMethods` argument; it owns the set internally seeded from `HTTP_STANDARD_METHODS` and extends it during scan. Private `getAllowedMethods(path)` renamed to `getAllowedMethodsForPath(path)` for clarity. The redundant `allowedMethods.has` check in `registerInternalRoutes` was deleted (the `method !== 'GET'` guard already covers it).

Migration: drop every `customMethods: [...]` argument; keep only the `@Method('X', ...)` decorators.
