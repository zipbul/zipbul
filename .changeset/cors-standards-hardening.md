---
"@zipbul/cors": minor
---

CORS STANDARDS conformance hardening and defect fixes (adversarially reviewed, TDD).

- Fix the published `.d.ts` failing to typecheck — `CorsError`'s constructor referenced a `@internal`-stripped `CorsErrorData`; the payload type is now part of the public surface.
- Bad boolean options (`credentials` / `preflightContinue` / `allowPrivateNetwork`) now throw a typed `CorsError` instead of a plain `Error`, honouring the documented `@throws` contract.
- `optionsSuccessStatus` is validated against the real 2xx `HttpStatus` set (not any `200–299` integer) and typed as `HttpStatus`; the unchecked `as HttpStatus` cast is removed.
- Origin functions returning an empty/blank string, or one bearing control characters (CR/LF → header injection), are treated as not-allowed instead of emitting a malformed `Access-Control-Allow-Origin`.
- `Cors.create` defensively copies array options so post-registration mutation of the caller's arrays cannot alter the resolved policy.
- `Vary: Access-Control-Request-Headers` is emitted unconditionally in reflect mode for cache correctness (Fetch §4.1.2 / RFC 9110).
- CORS-safelisted methods (GET/HEAD/POST) pass preflight even when omitted from `methods` (Fetch #cors-safelisted-method / STANDARDS §3.3.1).
- Both `Set-Cookie` and `Set-Cookie2` are stripped from `Access-Control-Expose-Headers` (Fetch forbidden-response-header-name / STANDARDS §4.1.4).
- Non-preflight `OPTIONS` (a real OPTIONS verb) now receives `Access-Control-Expose-Headers`, gated on preflight-ness rather than the method (Fetch §4.1.2).
- `CorsOptions` is now a type-only export (the baker `@Recipe` schema class no longer leaks as a runtime value from the barrel); `ResolvedCorsOptions` is derived from the schema, removing a second source of truth.
- Docs: add `STANDARDS.md` (rulebook), document the `corsMiddleware` export and `allowPrivateNetwork`, remove a documented-but-nonexistent `safe-regex2`/ReDoS guard, and correct several README/enum inaccuracies (EN + KO).
