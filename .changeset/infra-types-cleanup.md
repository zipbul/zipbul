---
"@zipbul/common": minor
"@zipbul/core": minor
"@zipbul/http-adapter": minor
"@zipbul/logger": minor
---

Type-system and DI infrastructure cleanup across the workspace.

- DI: `ZipbulContainer` gains an optional `hasRequestScope?()` capability; `Container.set()` tracks request-scope registration via flag, removing the `HttpServer.shouldCreateRequestScope()` downcast.
- Build pipeline: dropped the file-analysis cache (stale-cache build failures).
- Type SSOT: `HttpError` class replaced with `httpError()` factory (supports RFC 9110 phrase override); adapter hooks reach symmetry via `wrapValidationError` + `wrapUnhandledException` + `wrapInvalidFilterResult`; `ExceptionConstructorLike` parameter contravariance fixed; `AdapterOptions<AdapterClass>` fallback `Record<string, never>` → `unknown`; `HttpStatus` widened-enum sealed via template-literal type; `resolveProxyInfo` now uses the `HeaderField` enum SSOT; deprecated `XRealIp` enum removed (non-standard, NGINX-specific).
- Test tier reorganization: 3-tier model + perf split — `src/**/*.spec.ts` (unit), `test/integration/`, `test/e2e/`, `test/smoke/`, `test/perf/` (excluded from default runner). Added `httpError` factory spec, `emergencyTeardown` spec, and write-error / method-option / wrap-hooks specs.
- Tooling: pre-commit hook splits typecheck + `test:unit` from heavier tiers; `typescript@5.9.3` pinned at root for working `bunx tsc`; `dependency-cruiser` removed.
