# @zipbul/http-adapter

## 1.1.1

### Patch Changes

- 01938cb: Build pipeline migrated to the framework's own adapter compiler so the package's published `dist/` matches the manifest contract every other adapter uses.

  - `package.json#scripts.build` is now `bun ../../packages/cli/src/bin/zb.ts build adapter` (was a hand-written `bun build … && tsc -p tsconfig.build.json` pair). The CLI's adapter compiler emits the full manifest tree (`adapter.manifest.json`, `pipeline-schema.json`, `decorator-schema.json`, `peer-contract.json`, `context-namespaces.json`, `adapter-constructor-schema.json`) plus the JS bundle and `.d.ts`, then atomically promotes them into `dist/`.
  - `package.json#zipbul.kind` set to `"adapter"` so `zb build adapter` accepts the package and so user-app builds resolve it via the manifest-only contract.

  No source-level API changes — published runtime exports are unchanged.

- Updated dependencies [01938cb]
  - @zipbul/logger@0.2.1
  - @zipbul/core@0.3.1
  - @zipbul/common@0.3.0

## 1.1.0

### Minor Changes

- 55917f7: Adopted Bun workspace catalogs to centralize external dependency versions; every package now references shared deps via `catalog:`. Notable bumps applied through the catalog:

  - `@zipbul/baker` ^2.1.0 → ^2.2.0
  - `@zipbul/router` ^0.2.2 → ^0.2.3
  - `@zipbul/gildash` 0.24.4 → 0.24.5 (carries `oxc-parser` 0.127.0)
  - `oxc-parser` 0.121.0 → 0.127.0
  - `@clack/prompts` ^0.11.0 → ^1.2.0 (CLI usages verified compatible — `intro`/`outro`/`cancel`/`log` only, no removed APIs touched)
  - `mitata` ^0.1.13 → ^1.0.34 (benchmark migrated to `summary()` wrappers + nameless `group` model)
  - `dotenv` removed from `@zipbul/core` (unused — Bun loads `.env` natively)
  - `@types/node` ^22 → ^25.6.0
  - `@types/bun` → ^1.3.13
  - `@types/express` → ^5.0.6
  - `picocolors`, `exponential-backoff`, `reflect-metadata`, NestJS 11.x, `elysia` 1.4.x, `express` 5.2.x, `fastify` 5.8.x, `hono` 4.12.x — all bumped to current latest
  - `typescript` pinned at 5.9.3 (workspace-wide)

  The publish script now resolves both `workspace:` and `catalog:` protocols; npm registry receives concrete ranges.

- 55917f7: Removed the server-wide `allowedMethods` set and the 501 fast path. Unknown methods now uniformly resolve to `405 + Allow` (path exists) or `404` (no path), matching modern JS framework conventions (Express / Fastify / NestJS / Hono / Elysia) and RFC 9110 §15.5.6 (which makes `Allow` a `MUST` for 405) while skipping the §15.6.2 501 (a `SHOULD NOT` for "merely unwilling" cases).

  Removed:

  - `HttpServer.allowedMethods` field and the boot-time cache assignment
  - `validateHttpMethod()` helper, the `'not-implemented'` `CreateHttpRequestOutput` variant, and the `pipelineError` 501 branch (`createHttpRequest` no longer takes `allowedMethods`)
  - `RouteHandler.allowedMethods` set and `getServerAllowedMethods()`

  Behavior change: requests with an unknown method (including TRACE/CONNECT received over the wire — note that `@Method` handlers for those tokens are still rejected at boot) now return `404` if the path is unregistered, or `405` with `Allow` if the path exists with other methods. There is no automatic 501 path anymore. The `@Method` scan still validates the RFC 9110 §5.1 token and rejects `FORBIDDEN_HTTP_METHODS` (TRACE/CONNECT).

- 55917f7: Removed `HttpServerOptions.customMethods` — the `@Method('PURGE', '/path')` decorator is now the single source of truth.

  The double-declaration trap (where `@Method('PURGE', ...)` would fail boot unless `'PURGE'` was also listed in `customMethods`) is eliminated. The boot-time handler-index scan automatically discovers the methods used by `@Method` decorators and adds them to the allowed set; users no longer pass any method allowlist.

  Removed:

  - `HttpServerOptions.customMethods` field
  - `SafeCustomMethods<T>` utility type
  - `HttpServer` customMethods normalization block
  - Forbidden runtime check in `http-server.ts` (consolidated into route-handler scan)

  `RouteHandler` constructor no longer takes an `allowedMethods` argument; it owns the set internally seeded from `HTTP_STANDARD_METHODS` and extends it during scan. Private `getAllowedMethods(path)` renamed to `getAllowedMethodsForPath(path)` for clarity. The redundant `allowedMethods.has` check in `registerInternalRoutes` was deleted (the `method !== 'GET'` guard already covers it).

  Migration: drop every `customMethods: [...]` argument; keep only the `@Method('X', ...)` decorators.

- 55917f7: HTTP adapter subsystem extraction, RFC 9110 compliance hardening, and Bun native feature absorption.

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

  Tests: new `http-tls-sni-e2e`, `http-proxy-trust-e2e` (4 trustProxy modes × Forwarded/X-Forwarded-\*), `http-misc-e2e` (303/307/308 redirects, dangerous-scheme rejection, negative CL via raw TCP, custom maxUriLength, requestId header/generator, graceful drain), plus `dead-branch-proof.test.ts` proving unsupported-method requests are rejected before resolveRoute. Coverage 70% → 96% on affected modules.

- 55917f7: Permanent TRACE/CONNECT rejection — type-level + runtime double defense.

  `TRACE` (XST attack vector — OWASP) and `CONNECT` (RFC 9110 §9.3.6 forward-proxy semantics, meaningless on origin servers) are blocked at two layers:

  - **Compile time**: the `@Method` decorator generic `<const M>` rejects `Uppercase<M> extends ForbiddenHttpMethod ? never : M`, catching literal and case-variant tokens (`'TRACE'`, `'trace'`, `'Trace'`, `'CONNECT'`, `'Connect'`).
  - **Boot time**: `FORBIDDEN_HTTP_METHODS` runtime set rejects forbidden tokens during the `registerFromHandlerIndex` Phase 1 scan (catches `as any` casts and computed strings).

  `HTTP_STANDARD_METHODS` was reduced to the seven industry-convention methods (GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS); TRACE/CONNECT are not part of the standard set.

  Tests: 5 type-level `@ts-expect-error` directives (TRACE / CONNECT / trace / Trace / Connect) verified by `tsc --noEmit`, plus runtime rejection specs in route-handler and live boot-rejection e2e in `http-misc.e2e.test.ts`.

- 55917f7: Type-system and DI infrastructure cleanup across the workspace.

  - DI: `ZipbulContainer` gains an optional `hasRequestScope?()` capability; `Container.set()` tracks request-scope registration via flag, removing the `HttpServer.shouldCreateRequestScope()` downcast.
  - Build pipeline: dropped the file-analysis cache (stale-cache build failures).
  - Type SSOT: `HttpError` class replaced with `httpError()` factory (supports RFC 9110 phrase override); adapter hooks reach symmetry via `wrapValidationError` + `wrapUnhandledException` + `wrapInvalidFilterResult`; `ExceptionConstructorLike` parameter contravariance fixed; `AdapterOptions<AdapterClass>` fallback `Record<string, never>` → `unknown`; `HttpStatus` widened-enum sealed via template-literal type; `resolveProxyInfo` now uses the `HeaderField` enum SSOT; deprecated `XRealIp` enum removed (non-standard, NGINX-specific).
  - Test tier reorganization: 3-tier model + perf split — `src/**/*.spec.ts` (unit), `test/integration/`, `test/e2e/`, `test/smoke/`, `test/perf/` (excluded from default runner). Added `httpError` factory spec, `emergencyTeardown` spec, and write-error / method-option / wrap-hooks specs.
  - Tooling: pre-commit hook splits typecheck + `test:unit` from heavier tiers; `typescript@5.9.3` pinned at root for working `bunx tsc`; `dependency-cruiser` removed.

- 55917f7: Moved sibling and `@zipbul/result` dependencies out of `peerDependencies` into `dependencies`. Consumers no longer need to install `@zipbul/common`, `@zipbul/core`, `@zipbul/logger`, or `@zipbul/result` explicitly when adding `@zipbul/http-adapter` — `bun add @zipbul/http-adapter` is sufficient. `@zipbul/baker` remains a `peerDependency` (external integration), and `typescript` stays a `peerDependency` of `@zipbul/logger` (compiler version owned by the host project).

### Patch Changes

- Updated dependencies [55917f7]
- Updated dependencies [55917f7]
- Updated dependencies [55917f7]
  - @zipbul/common@0.3.0
  - @zipbul/core@0.3.0
  - @zipbul/logger@0.2.0

## 1.0.0

### Minor Changes

- 27e00f7: ### @zipbul/http-adapter

  **파이프라인 재설계** — 7-phase 파이프라인으로 전환.

  #### Breaking Changes

  - `HttpPhase` enum 값 변경:
    - `BeforeParsing` → `BeforeParse`
    - `BeforeValidation` → `BeforeValidate`
    - `BeforeHandler` → `BeforeHandle`
    - `Cleanup` → `AfterResponse`
  - `HttpPhase.AfterHandle` 신규 추가 (결과 변환/엔벨로프, 버퍼드만)
  - `HttpPhase.BeforeResponse` 동작 변경: 직렬화 후 실행, **모든 응답 타입**(SSE/네이티브 포함)에서 실행
  - `ResponseFinalizerFn`, `addResponseFinalizer()`, `runResponseFinalizers()` 제거
  - `HttpResponse.serialize()` 공개 메서드 추가 (JSON.stringify + Content-Type 추론을 `build()`에서 분리)

  #### New Features

  - `@Method('PURGE', '/path')` 데코레이터 — 커스텀 HTTP 메서드 지원. `HttpServerOptions.customMethods`와 함께 사용.

  #### Bug Fixes

  - 204 응답에서 `Content-Type` 헤더 제거 (RFC 9110 §15.3.5)
  - `customMethods` 옵션이 실제로 동작하도록 수정 (`isHttpMethod` 가드 제거, `@Method` 데코레이터 추가)

  #### Pipeline

  ```
  OnRequest → [resolveRoute] → BeforeParse → [parseBody] → BeforeValidate → [runValidations + guards]
    → BeforeHandle → [handler] → AfterHandle → [serialize] → BeforeResponse → [build + send] → AfterResponse
  ```

  ### @zipbul/common

  - `Adapter`, `inject`, `lazy`, `runInInjectionContext`를 `@zipbul/core`로 이동
  - `ContextKey`, `contextKey()`, `Validated<T>` 타입 추가
  - Baker decorator re-export 제거 (직접 `@zipbul/baker/decorators`에서 import)
  - `CompiledOptionEntry`, `CompiledValidationEntry` 타입 추가

  ### @zipbul/core

  - `Adapter` 베이스 클래스를 `@zipbul/common`에서 이동
  - `inject()`, `lazy()`, `runInInjectionContext()` 이동
  - `getContext()`, `runInRequestContext()` 추가
  - `ResolvedValidationEntry` 타입 추가

### Patch Changes

- Updated dependencies [27e00f7]
  - @zipbul/common@0.2.0
  - @zipbul/core@0.2.0

## 0.1.3

### Patch Changes

- Updated dependencies [e90133f]
  - @zipbul/core@0.1.3

## 0.1.2

### Patch Changes

- Updated dependencies [91f95b3]
  - @zipbul/core@0.1.2

## 0.1.1

### Patch Changes

- 77f9a1b: Initial npm publish setup with CI pipeline and OIDC provenance
- Updated dependencies [77f9a1b]
  - @zipbul/common@0.1.1
  - @zipbul/logger@0.1.1
  - @zipbul/core@0.1.1
