# @zipbul/common

## 0.3.0

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

- 55917f7: Type-system and DI infrastructure cleanup across the workspace.

  - DI: `ZipbulContainer` gains an optional `hasRequestScope?()` capability; `Container.set()` tracks request-scope registration via flag, removing the `HttpServer.shouldCreateRequestScope()` downcast.
  - Build pipeline: dropped the file-analysis cache (stale-cache build failures).
  - Type SSOT: `HttpError` class replaced with `httpError()` factory (supports RFC 9110 phrase override); adapter hooks reach symmetry via `wrapValidationError` + `wrapUnhandledException` + `wrapInvalidFilterResult`; `ExceptionConstructorLike` parameter contravariance fixed; `AdapterOptions<AdapterClass>` fallback `Record<string, never>` → `unknown`; `HttpStatus` widened-enum sealed via template-literal type; `resolveProxyInfo` now uses the `HeaderField` enum SSOT; deprecated `XRealIp` enum removed (non-standard, NGINX-specific).
  - Test tier reorganization: 3-tier model + perf split — `src/**/*.spec.ts` (unit), `test/integration/`, `test/e2e/`, `test/smoke/`, `test/perf/` (excluded from default runner). Added `httpError` factory spec, `emergencyTeardown` spec, and write-error / method-option / wrap-hooks specs.
  - Tooling: pre-commit hook splits typecheck + `test:unit` from heavier tiers; `typescript@5.9.3` pinned at root for working `bunx tsc`; `dependency-cruiser` removed.

- 55917f7: Moved sibling and `@zipbul/result` dependencies out of `peerDependencies` into `dependencies`. Consumers no longer need to install `@zipbul/common`, `@zipbul/core`, `@zipbul/logger`, or `@zipbul/result` explicitly when adding `@zipbul/http-adapter` — `bun add @zipbul/http-adapter` is sufficient. `@zipbul/baker` remains a `peerDependency` (external integration), and `typescript` stays a `peerDependency` of `@zipbul/logger` (compiler version owned by the host project).

## 0.2.0

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

## 0.1.1

### Patch Changes

- 77f9a1b: Initial npm publish setup with CI pipeline and OIDC provenance
