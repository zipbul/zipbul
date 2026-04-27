---
"@zipbul/http-adapter": minor
---

Permanent TRACE/CONNECT rejection — type-level + runtime double defense.

`TRACE` (XST attack vector — OWASP) and `CONNECT` (RFC 9110 §9.3.6 forward-proxy semantics, meaningless on origin servers) are blocked at two layers:

- **Compile time**: the `@Method` decorator generic `<const M>` rejects `Uppercase<M> extends ForbiddenHttpMethod ? never : M`, catching literal and case-variant tokens (`'TRACE'`, `'trace'`, `'Trace'`, `'CONNECT'`, `'Connect'`).
- **Boot time**: `FORBIDDEN_HTTP_METHODS` runtime set rejects forbidden tokens during the `registerFromHandlerIndex` Phase 1 scan (catches `as any` casts and computed strings).

`HTTP_STANDARD_METHODS` was reduced to the seven industry-convention methods (GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS); TRACE/CONNECT are not part of the standard set.

Tests: 5 type-level `@ts-expect-error` directives (TRACE / CONNECT / trace / Trace / Connect) verified by `tsc --noEmit`, plus runtime rejection specs in route-handler and live boot-rejection e2e in `http-misc.e2e.test.ts`.
