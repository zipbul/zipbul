---
"@zipbul/http-adapter": minor
"@zipbul/common": minor
"@zipbul/core": minor
---

### @zipbul/http-adapter

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
