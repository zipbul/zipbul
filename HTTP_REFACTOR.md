# @zipbul/http-adapter 리팩토링 계획 (v3)

## 0. 증거 원칙 / 프로세스 기록

### 0.1 증거 태그
모든 기술적 주장은 태그를 가진다:
- `[verified: <file>:<line>]` — 저자가 직접 Read/Grep로 확인.
- `[agent-verified: <file>:<line>]` — 에이전트 보고 + 저자 sampling 재검증.
- `[reason: <근거>]` — 검증 대상 아닌 설계 판단.
- **`[unverified]`는 v3에서 0건**. 모든 사실은 검증 완료.

### 0.2 수행 이력
1. **1차 조사** (6개 병렬 Explore 에이전트): 타입중복 / HttpRequest mutable재할당 / `__internals` 소비처 / 알고리즘 라인검증 / core 연계계약 / 에러계층 감사.
2. **2차 조사** (5개 병렬 에이전트): 외부 npm(`@zipbul/baker|shared|router|result`) 타입중복 / unverified 6건 전수해소 / 대안설계 A·B·C 비교 / 알고리즘 최적화 diff / 결합·범위 재검토.
3. **Adversarial pass 2회**: 1차(6 제안 반증), 2차(v2 문서 자체 반증 — LOC 오차 + reset race 발견).
4. **Sampling 재검증** (저자): LOC 실측, 33개 에러 sampling 6건, ClassMetadata.methods 실사용, core의 baker 결합, CoreStep public export 등 핵심 claim 직접 Read.

### 0.3 에이전트 오류 정정
- 1차 타입 중복 에이전트가 `DecoratorArgument` 중복 누락 → 보정 `[verified: types.ts:197-211, core/src/injector/types.ts:26-36]`.
- 1차 에러 계층 에이전트가 `require()` 동적 import 놓침 → 3개 클래스(`RequestTooLongError`, `RequestUriTooLongError`, `UnprocessableEntityError`)가 spec에서 실사용 확인 `[verified: http-adapter.spec.ts:4128-4146]`.
- v2 문서의 LOC 오차 정정: `http-server.ts`(644→643), `route-handler.ts`(439→438) `[verified: wc -l 실측]`.
- 1차 알고리즘 에이전트의 `HttpResponse.setBody` → `_serialized` 리셋 누락 버그 확인 `[verified: http-response.ts:223-250]`.
- 2차 adversarial의 `HttpResponse.reset()`/`setBody()`의 `void ... .cancel()` fire-and-forget 추가 발견 `[verified: http-response.ts:82, 225, 233, 245]`.

---

## 1. 사전 결정사항 (합의 필요)

1. **Public API 변경 범위**: `packages/http-adapter/package.json:exports`가 `"."`만 허용 → deep import 차단 `[verified]`. 그러나 monorepo 내부/linked package는 우회 가능 → 사용자 코드 deep import 여부는 조사 불가(외부). 본 계획은 "deep import 안 함"을 기본 가정.
2. **동작 보존 기본**: Phase 1-4은 behavior-preserving. Phase 4의 API 단정화(에러 제거/readonly 전환)는 개별 합의 후 진행.
3. **착수 순서**: §6 Phase 순서 엄수. Phase 건너뛰기 금지.

---

## 2. 검증된 사실 (Findings)

### F1. `errors/errors.ts`와 `errors/index.ts` 완전 중복
`[verified: errors/errors.ts:1-37, errors/index.ts:1-37]` — 37줄 동일.
`[verified: grep 결과 0건]` — `from ['"].*errors/errors`, `require\(['"].*errors/errors` 둘 다 repo 전역 0건. 단 `packages/common/src/errors/errors.ts`는 `ZipbulError`를 export하는 별도 파일 — http-adapter의 것과 무관.

### F2. core와의 타입 중복 (정정됨)

| 타입 | http-adapter 정의 | core SSOT | 관계 |
|------|------------------|----------|------|
| `DecoratorMetadata` | `types.ts:215-218` | `core/src/injector/types.ts:50-53` | 완전 동일 `[verified]` |
| `TokenRecord` | `types.ts:187-191` | `core/src/injector/types.ts:20-24` | 완전 동일 `[verified]` |
| `ConstructorParamMetadata` | `types.ts:220-223` | `core/src/injector/types.ts:55-58` | 부분 중복: `type?` 필드가 http-adapter는 `ParamTypeReference`(=ProviderToken), core는 `ProviderToken \| TokenRecord` `[verified]` |
| `ClassMetadata` | `types.ts:230-235` | `core/src/injector/types.ts:60-63` | 부분 중복: http-adapter가 `className?`, `methods?` 필드 확장 `[verified]` |
| `DecoratorArgument` | `types.ts:197-211` | `core/src/injector/types.ts:26-36` | 부분 중복: http-adapter가 `MiddlewareDefinition`, `ErrorConstructor`, `PrimitiveArray`, `PrimitiveRecord` 확장 `[verified]` |

http-adapter는 이미 core 타입을 `CoreClassMetadata`, `CoreConstructorParamMetadata`, `CoreDecoratorMetadata` alias로 import 중 `[verified: http-adapter.ts:11-15]` — **두 정의가 공존하는 상태**.

- `ClassMetadata.methods` 필드는 CLI 컴파일러가 사용 `[verified: cli/src/compiler/analyzer/adapter/handler-index-builder.ts:100, phase-id-validator.ts:184, metadata-generator.ts:325, scalar/src/openapi/controller.ts:11]` → **유지 필수**.

### F3. 외부 npm 패키지와의 타입 중복 없음
`[agent-verified]` (`node_modules/.bun/` 경로의 `@zipbul/{baker,shared,router,result}` d.ts 조사):
- `HttpMethod` — shared의 `types/http-method.d.ts:15`에서 import 후 re-export만. 재정의 없음 `[verified: types.ts:15]`.
- `Result`, `Err`, `err`, `isErr` — result에서 import만, 재정의 없음 `[verified: http-adapter.ts:3-4]`.
- `Router`, `RouterOptions` — router에서 import만.
- `isBakerError`, `BakerErrors` — baker에서 import만.
- `JsonValue/JsonArray/JsonObject/JsonPrimitive/ContentTypeInfo`는 외부 4개 패키지에 없음 → http-adapter 고유.

### F4. `HttpAdapter → http-server.ts __internals` 런타임 역의존
`[verified: http-adapter.ts:27]` — `import { __internals as httpServerInternals } from './http-server';`.
호출 지점 `[verified]`:
- `http-adapter.ts:430` — `httpServerInternals.resolveRawBody(http.matchedRoute)`
- `http-adapter.ts:468, 494, 510` — `httpServerInternals.parseJsonBody(...)`

### F5. `HttpRequest` public mutable 필드 재할당 현황 `[agent-verified]`

| 필드 | 재할당 | 지점 |
|------|--------|------|
| `method` | 0회 | — |
| `url` | 0회 | — |
| `path` | 0회 | — |
| `query` | 0회 | — |
| `body` | 7회 | `http-adapter.ts:468, 473, 494, 499, 510, 522, 533` |
| `params` | 1회 | `http-adapter.ts:389` |
| `rawBody` | 1회 | `http-adapter.ts:457` |

### F6. 문서화된 미들웨어 설계 의도
`[verified: enums.ts:20-21]` — `OnRequest` phase 주석: "CORS, logging, **method override, URL rewriting**".
현재 프레임워크 내 `req.method =`, `req.url =` 재할당 0건이지만 **사용자 미들웨어가 재할당하도록 설계 의도 명시**. F5 0회 재할당을 이유로 한 readonly 전환은 이 의도 위배.

### F7. `__internals` 24개 심볼 소비 구조 `[agent-verified]`
- **Runtime dependency (18개)**: `parseParameters`, `parseContentLength`, `validateHttpMethod`, `normalizeIp`, `parseJsonBody`, `resolveRawBody`, `validateForwardedHost`, `parseForwardedLast`, `evaluateTrustProxy`, `resolveProxyInfo`, `resolveClientIp`, `isTrustedIp`, `isInCidrRange`, `matchesCidr`, `ipv4ToNumber`, `ipv6ToBytes`, `matchesPrefix`, `createHttpRequest`
- **Test-only (6개)**: `parseContentTypeInfo`, `resolveRequestId`, `validateRequestId`, `extractHostname`, `extractPort`, `defaultPortByProtocol`
- **테스트 누락**: `ipv6ToBytes`, `matchesPrefix`는 단위 테스트 직접 케이스 부재

### F8. `route-handler.ts` 옵션 스캔 중복
`[verified: route-handler.ts:162-174]` — `entry.options?.some/find/filter` 호출이 7회 반복 (RawBody, Sse, BodyLimit, Status, Redirect, ContentType, Header).

### F9. HEAD 자동 등록 중복
`[verified: route-handler.ts:211-215, 259-263]` — 동일 패턴 2회.

### F10. `adapter-definition.ts`의 CoreStep 문자열 하드코딩
`[verified: adapter-definition.ts:25, 26, 28]` — `'Validation'`, `'Guard'`, `'Handler'` 리터럴(27번 라인은 `HttpPhase.BeforeHandle`).
`CoreStep` enum은 core public export `[verified: packages/core/index.ts:16]`. 값은 동일 문자열 `[verified: core/src/adapter/enums.ts:9-16]`.
AOT 컴파일러는 string 배열로 매칭 `[verified: packages/cli/src/compiler/analyzer/adapter/config-extractor.ts:378-383]` — enum 교체 시 매칭 유지.

### F11. 36개 구체 에러 클래스 사용 실태
`packages/http-adapter/index.ts:28`은 `HttpError`만 public export `[verified]`.
사용 확정 3개 `[verified: http-adapter.spec.ts:4128-4129, 4135-4136, 4142-4143]`: `RequestTooLongError`, `RequestUriTooLongError`, `UnprocessableEntityError`.
나머지 33개 전수 grep (`new XxxError(`, `instanceof XxxError`, `import.*errors/<kebab>`, `require\(.*errors/<kebab>`) 4개 패턴 모두 0건 `[agent-verified + sampling: BadGatewayError/GatewayTimeoutError/ImATeapotError/LockedError/UpgradeRequiredError/HTTPVersionNotSupportedError 직접 grep 0건 확인]`.

### F12. 버그: `HttpResponse.setBody` → `_serialized` 리셋 누락
`[verified: http-response.ts:223-250]` — 3개 분기(ReadableStream/Blob/buffered) 모두 `_serialized` 리셋 없음.

재현 경로 `[verified: adapter-definition.ts:19-34]`:
1. 파이프라인: `... Serialize → BeforeResponse → AfterResponse`.
2. `Serialize` step에서 `response.serialize()` → `_serialized=true`, `_body`를 JSON 문자열화.
3. `BeforeResponse` 미들웨어가 `response.setBody(newObject)` 호출 → `_body=객체`, `_serialized=true` 유지.
4. `HttpServer.fetch` 종료 시 `zipbulRes.end()` → `build()` → 내부 `this.serialize()` 재호출 → `_serialized===true`로 조기 return.
5. `normalizeBody()`가 `_body` 객체 도달 시 throw `[verified: http-response.ts:485-502]`.

`reset()`은 `_serialized=false` 리셋하지만 `setBody`는 안 함 `[verified: http-response.ts:81-94 vs 223-250]`.

### F13. 잠재 위험: `_rawNativeResponse.body.cancel()`의 fire-and-forget
`[verified: http-response.ts:82, 225, 233, 245, 275, 340]` — `void this._rawNativeResponse?.body?.cancel();` 6개 지점. `cancel()`이 `Promise<void>` 반환하지만 await 없음. unhandled promise rejection 가능성 + 새 응답 생성과 이전 스트림 정리의 race.
`[reason: 의도적 fire-and-forget인지 누락인지 주석 없음. 동작상 치명적이진 않으나 개선 여지]`.

### F14. `HttpResponse._status: StatusCodes | 0` 센티넬
`[verified: http-response.ts:16]` — `0`이 "unset" 의미. 체크 지점 3곳 `[verified: http-response.ts:399, 420, 427]`.

### F15. `http-adapter.ts` 다중 책임 (898 LOC) `[verified: wc -l]`
`[verified: http-adapter.ts:198-244, 300-353, 363-393, 402-536, 548-561, 571-581, 590-606, 622-676, 680-822, 836-897]` — 7개 책임 혼재:
- 파이프라인 실행
- 라우트 resolve
- body 파싱
- middleware runner
- validation error wrapping
- lifecycle (start/stop/drain/emergencyTeardown)
- 응답 작성
- metadata 정규화

### F16. `http-server.ts` 다중 책임 (643 LOC) `[verified: wc -l]`
`[verified: http-server.ts:68-361, 365-424, 428-615, 618-643]` — 4개 책임:
- Bun.serve 래퍼 + fetch 루프 (HttpServer 클래스)
- Proxy/IP 서브시스템 (약 250 LOC)
- `createHttpRequest` 팩토리
- `__internals` 테스트 노출

### F17. `writeError`/`writeSuccess`는 순수함수 추출 가능 `[agent-verified + verified]`
`[verified: http-adapter.ts:680-704, 717-800]` — `this.` 참조 2건만:
- `:689` — `this.isErrorResponseData(errorData)`
- `:797` — `this.isResponseBodyValue(result)`

두 헬퍼는 순수 `[verified: http-adapter.ts:802-822, 824-831]` → 별도 모듈의 함수로 뽑을 수 있음 + 인스턴스 상태 참조 0건.

### F18. `wrapValidationError`의 baker 결합은 제거 불가
`[verified: http-adapter.ts:30, 548-561]` — `isBakerError` import 및 사용.
`[verified: packages/core/src/adapter/adapter.ts:3]` — core 자체가 `import { deserialize, isBakerError } from '@zipbul/baker'` 사용.
즉 **core가 이미 baker에 결합**되어 있어 http-adapter만 분리해도 의미 없음. 공통 validator 추상화는 core 수정 필요.
`[reason: baker가 기본 validator라는 전제에서, HTTP 400 매핑은 http-adapter의 당연한 책임. YAGNI]`.

### F19. `HttpContext.to()`는 AdapterContext 계약
`[verified: packages/common/src/interfaces.ts:64]` — `to<TContext extends ZipbulValue>(ctor: ClassToken<TContext>): TContext`가 인터페이스 필수 메서드.
자기 자신만 허용하는 현 구현 `[verified: http-context.ts:73-79]`은 계약 준수 최소 구현. **제거 불가**.

### F20. `decorators/method-option.decorator.ts` 153 LOC에 7개 no-op
`[verified]` — AOT 컴파일러는 decorator name만 인식 `[agent-verified: cli/src/compiler/analyzer/adapter/decorator-extractor.ts:89-126]`. 파일 분리는 기능상 무관 — 순수 코드 조직 정책 결정.

### F21. `server-sent-event.ts` (106 LOC)는 응집력 적절
`[verified: server-sent-event.ts:1-106]` — `ServerSentEvent` 클래스 + `formatSSEChunk` + `isAsyncIterable` + 3개 private helper. 단일 SSE 규격 도메인. **분리 미권고**.

### F22. LOC 현황 (정정됨, `wc -l` 실측)
- `http-adapter.ts`: 898
- `http-server.ts`: 643 (v2의 644 오기)
- `http-response.ts`: 541
- `route-handler.ts`: 438 (v2의 439 오기)
- `http-request.ts`: 213
- `http-context.ts`: 120
- `server-sent-event.ts`: 106

---

## 3. 반증 통과 결과 (adversarial pass 2회)

| 제안 | 결과 | 조치 |
|------|------|------|
| proxy/ 디렉토리 추출 | `[found]` __internals 구조 공존 필요 | **수정 후 진행** (§5 Phase 2-1) |
| parseBody 3분기 **통합** | `[found]` CL fast path(`rawReq.json()`)는 Bun UTF-8 강제, TypeError throw-through 의도 → 통합 불가 | **폐기** (이동만, 통합 금지) |
| `method/url/path/query` readonly | `[found]` F6의 문서 의도 위배 | **보류** (§5 Phase 4-2 개별 합의) |
| CoreStep enum 교체 | `[survived]` 안전 | **진행** (§5 Phase 3) |
| 33개 에러 제거 | `[survived]` 전수 grep 0건 완료 | **진행** (§5 Phase 4-1) |
| `setBody`에 `_serialized=false` 추가 | `[survived]` 재진입 경로 실재 | **진행** (§5 Phase 1-4) |
| `HttpContext.to()` 단순화/제거 | `[blocked]` F19 계약 | **보류** (현상 유지) |
| `wrapValidationError` baker 분리 | `[blocked]` F18 core 결합 | **보류** (현상 유지) |
| `decorators/` 7 파일 분할 | `[neutral]` 기능상 무관 | **보류** (1 class 1 file 정책 강행 시 선택적) |
| SSE 분리 | `[neutral]` 응집력 충분 | **보류** |
| `writeError/Success` 순수함수 추출 | `[survived]` F17 검증 완료 | **진행** (§5 Phase 2-3) |

---

## 4. 아키텍처 대안 비교

A (기능 중심) vs B (phase 중심) vs C (클래스 분해) — `[agent-verified: Plan 에이전트 결과]`.

| 기준 | A | B | C |
|------|---|---|---|
| SRP 명확성 | 높음 | 중(모델 위치 모호) | 중(상태없는 클래스) |
| 파일 증가 | +12 | +25~30 | +12~15 |
| 테스트 파괴 | 중 | 큼 | 중 |
| 확장성 | 중 | 표면상↑ 실제↓ | 낮음 |
| 위험도 | 낮음 | 높음 | 중 |
| AOT 어휘 정합 | 높음 | **불일치** | 높음 |
| CLAUDE.md 원칙 부합 | 높음 | 중 | **낮음**(상태 없는 클래스) |
| PR 수 | ~20 (작음) | ~12-15 (큼) | ~10-12 (큼) |

### 선택: 대안 A (기능 중심)

**근거**:
1. AOT 어휘(`HttpStep`/`HttpPhase`) 보존 → AOT 컴파일러 수정 0. `[reason: B는 phase 디렉토리 어휘와 AOT HttpStep 어휘 분기]`
2. 런타임 객체 그래프 불변 → 인스턴스화 변화 없음. `[reason: C는 런타임 컴포넌트 인스턴스화 추가, "빌드타임 지능" 원칙과 긴장]`
3. CLAUDE.md "구조가 규칙을 대체" + "명시성" 원칙 일치. 디렉토리명 = 책임명 → grep 한 번으로 도달.
4. 점진적 PR 분할 가능 (약 20 PR, 각 PR이 작음) → 회귀 격리 용이.
5. `[reason: C의 HttpBodyReader/HttpResponseWriter/HttpMetadataRegistry는 상태 거의 없는 옵션 캡처 클래스 — CLAUDE.md "Class 사용 기준" 위반]`

**약점 (인지)**:
- `adapter-step-fns.ts` 추출 시 HttpAdapter의 4개 메서드 클로저 의존 → deps 인터페이스 신설 필요.
- `body/`와 `response-writer/`의 대칭성은 외관만 — `body/`는 `HttpRequest` in-place mutation, `response-writer/`는 `HttpResponse` 메서드 호출. 내부 모델 비대칭.

---

## 5. 실행 계획

### Phase 0 — 안전망 (전부 착수 전 필수)

#### 0-1. Coverage baseline
`bun test --coverage` → 결과를 `HTTP_REFACTOR_COVERAGE.md`에 기록.

#### 0-2. 누락 테스트 보강
- `ipv6ToBytes` 단위 테스트 (F7): `::`, `::1`, `1::`, `1::2`, `::ffff:10.0.0.1`, embedded IPv4 최대값(`::ffff:255.255.255.255`), `fe80::`, 완전형 `0:0:0:0:0:0:0:1`, 잘못된 입력.
- `matchesPrefix` 단위 테스트 (F7): prefix 0, 8, 9, 64, 127, 128, 부분 바이트 마스크.
- F12 회귀 테스트: `HttpResponse.setBody → serialize → setBody → end()` 시나리오 **현 코드에서 fail 확인** 후 수정 후 pass.
- F13 회귀 테스트: `setBody(stream1) → setBody(stream2)` 중복 호출 시 stream1이 cancel되는지 + cancel promise가 unhandled rejection을 유발하지 않는지.

#### 0-3. `ClassMetadata.methods` 사용 범위 명시
이미 검증됨 `[verified: F2]` — CLI 컴파일러가 사용. Phase 1-2에서 타입 확장 패턴(`HttpClassMetadata = CoreClassMetadata & { className?; methods? }`)으로 유지 확정.

#### 0-4. Phase 0 완료 조건
모든 테스트 추가 완료 + pass 확인 + coverage 리포트 제출. 미완료 시 Phase 1 진입 금지.

---

### Phase 1 — 저위험 정리

#### 1-1. `errors/errors.ts` 삭제
- F1 완전 검증 완료.
- 단일 PR.

#### 1-2. core와의 타입 SSOT 통일 (F2)
4개 독립 PR:

**PR 1-2a: `TokenRecord` 제거**
- `http-adapter/src/types.ts:187-191` 삭제 → core에서 import.

**PR 1-2b: `DecoratorMetadata` 제거**
- `types.ts:215-218` 삭제 → core에서 import.

**PR 1-2c: `ConstructorParamMetadata` 제거 + core 타입 사용**
- `types.ts:220-223` 삭제 → core의 `ConstructorParamMetadata`로 교체.
- `type?` 필드가 `ProviderToken | TokenRecord`로 넓어지므로 `metadata/normalize.ts`의 `isProviderToken` 가드 계속 유효.

**PR 1-2d: `ClassMetadata` 확장 형태로 재작성**
- 현 `ClassMetadata`를 `HttpClassMetadata`로 개명.
- `HttpClassMetadata = CoreClassMetadata & { className?: string; methods?: readonly MethodMetadata[] }`.
- `MethodMetadata`는 http-adapter 고유 유지 (core에 없음).

**PR 1-2e: `DecoratorArgument` 관계 문서화**
- http-adapter의 `DecoratorArgument`는 core + http-adapter 확장 유니온. 구조상 재정의 불가피 → 주석으로 SSOT 경계 명시:
  ```ts
  // http-adapter extends core's DecoratorArgument with protocol-specific types.
  // core DecoratorArgument := ProviderToken | TokenRecord | ModuleMetadata | primitive | null | undefined
  // http-adapter adds: MiddlewareDefinition, ErrorConstructor, PrimitiveArray, PrimitiveRecord, TokenCarrier
  ```

#### 1-3. `_status` 센티넬 제거 (F14)
- `_status: StatusCodes | undefined = undefined`.
- `getStatus(): StatusCodes | undefined`.
- 외부 소비처 업데이트:
  - 테스트 31+ 지점 `[agent-verified]` — `expect(res.getStatus()).toBe(N)`는 그대로 pass.
  - `http-adapter.ts` 내부 `res.setStatus(...)` 호출은 영향 없음.

#### 1-4. **F12 버그 수정**
- `setBody()` 내 3분기 공통 후처리로 `this._serialized = false;` 추가.
- Phase 0-2의 회귀 테스트 fail → pass 확인.

#### 1-5. **F13 fire-and-forget 명시화**
- `void ... .cancel()` 6개 지점에 의도 주석 추가 또는 헬퍼 `cancelNativeStreamQuietly()` 신설:
  ```ts
  private cancelNativeStreamQuietly(): void {
    const body = this._rawNativeResponse?.body;
    if (body === null || body === undefined) return;
    void body.cancel().catch(() => { /* fire-and-forget: stream already closed */ });
  }
  ```
- unhandled rejection 방어.

---

### Phase 2 — 서브시스템 추출 (대안 A)

Phase 1 완료 후 병렬 진행 가능. 각 하위 단계는 독립 PR.

#### 2-1. `proxy/` 디렉토리 추출 (F16)

```
src/proxy/
├── index.ts            — facade export
├── cidr.ts             — isInCidrRange, matchesCidr, ipv4ToNumber, ipv6ToBytes, matchesPrefix
├── ip-normalize.ts     — normalizeIp
├── forwarded-parser.ts — parseForwardedLast, validateForwardedHost (parseParameters는 content-type.ts에서 import)
├── trust-proxy.ts      — evaluateTrustProxy, isTrustedIp
└── resolve.ts          — resolveProxyInfo, resolveClientIp
```

- `http-server.ts`의 `__internals` 객체는 `...proxyExports` spread로 유지 (외부 계약 보존).
- 6 독립 PR (파일별 추출).
- spec 파일은 일단 `__internals` 경로 유지, Phase 5에서 직접 import로 전환.

#### 2-2. `body/` 디렉토리 추출 (F4, F15)

```
src/body/
├── index.ts
├── read-with-limit.ts    — readBodyWithLimit (http-adapter.ts:43-99에서 이동)
├── parse-json.ts         — parseJsonBody (http-server.ts:96-100에서 이동)
└── parser.ts             — parseBody (3분기 그대로 보존 — 통합 금지)
```

**주의사항** (adversarial 반증 반영):
- `parseBody`의 3분기 구조 보존 — CL fast path의 `rawReq.json()` 유지 (Bun UTF-8 강제 의존), `SyntaxError` 외 TypeError throw-through 유지.
- F4 역의존 제거: `resolveRawBody` → `http.matchedRoute?.rawBody === true` 인라인 체크로 치환(`MatchedRouteMetadata.rawBody` 필드는 이미 존재 `[verified: types.ts:131]`).

3 독립 PR:
1. `read-with-limit` 추출
2. `parse-json` 추출
3. `parser` 추출 (가장 민감 — 회귀 테스트 전수 실행)

#### 2-3. `response-writer/` 추출 (F17)

```
src/response-writer/
├── index.ts
├── write-error.ts      — writeErrorResponse
├── write-success.ts    — writeSuccessResponse (SSE/streaming/bigint/buffered 분기)
└── type-guards.ts      — isErrorResponseData, isResponseBodyValue
```

F17로 순수함수 추출 확정. HttpAdapter 상태 참조 없음. 단일 PR.

#### 2-4. `route-options/` 추출 (F8)

```
src/route-options/
├── index.ts
├── parse-decorator-options.ts   — 단일 순회로 ParsedDecoratorOptions 생성
└── response-defaults.ts          — buildResponseDefaultsApplier (route-handler.ts:411-438에서 이동)
```

`ParsedDecoratorOptions` 타입 정의:
```ts
interface RedirectSpec {
  readonly url: string;
  readonly status?: 301 | 302 | 303 | 307 | 308;
}

interface ParsedDecoratorOptions {
  readonly rawBody: boolean;
  readonly sse: boolean;
  readonly bodyLimit: number | undefined;
  readonly status: number | undefined;
  readonly redirect: RedirectSpec | undefined;
  readonly contentType: string | undefined;
  readonly headers: readonly (readonly [string, string])[];
}
```

`route-handler.ts:162-174`의 7회 순회 → 1회.

#### 2-5. HEAD 자동 등록 헬퍼 (F9)

```
src/pipeline/router-register.ts
```
```ts
export function addWithHeadAlias(
  args: {
    router: Router<MatchedRouteMetadata>;
    method: string;
    path: string;
    entry: MatchedRouteMetadata;
    registeredMethods: Set<string>;
    logger: Logger;
    sourceLabel: string;
  }
): void;
```
파라미터 7개 → 단일 인자 객체 (CLAUDE.md "함수 파라미터 3개 초과 시 interface화" 준수).

#### 2-6. `metadata/` 추출 (F15)

`http-adapter.ts:836-897`를 전량 이동:
```
src/metadata/
├── index.ts
├── normalize.ts        — normalizeMetadataRegistry, toHttpClassMetadata, normalizeCoreDecorators, normalizeCoreConstructorParams
└── type-guards.ts      — isProviderToken, isClassToken, isHttpClassMetadata
```

#### 2-7. `pipeline/adapter-step-fns.ts` 추출

`http-adapter.ts:300-353`를 별도 파일로. **adversarial 약점 반영**: 4개 함수 클로저 의존 해결을 위해 deps 객체 파라미터 사용.

```ts
interface AdapterStepDeps {
  readonly parseBody: (http: HttpContext) => Promise<Result<void, ErrorResponseData>>;
  readonly runHttpMiddlewares: (list: readonly ResolvedMiddleware[], http: HttpContext) => Promise<Result<void, unknown>>;
  readonly writeErrorResponse: (res: HttpResponse, errorData: unknown) => void;
  readonly writeSuccessResponse: (res: HttpResponse, result: unknown, http: HttpContext) => Promise<void>;
  readonly getPhaseMiddlewares: (phase: string) => readonly ResolvedMiddleware[];
}

export function buildAdapterStepFns(
  phaseMws: Readonly<Record<string, readonly ResolvedMiddleware[]>>,
  deps: AdapterStepDeps,
): ReadonlyMap<string, PipelineStepFn>;
```

HttpAdapter는 조립만 담당:
```ts
const stepFns = buildAdapterStepFns(phaseMws, {
  parseBody: (http) => parseBody(http, this.options.bodyLimit!, this.textMediaTypes),
  runHttpMiddlewares: this.runHttpMiddlewares.bind(this),
  writeErrorResponse,
  writeSuccessResponse,
  getPhaseMiddlewares: this.getPhaseMiddlewares.bind(this),
});
```

#### Phase 2 목표 (`wc -l` 재측정 기준)
- `http-adapter.ts`: 898 → **목표 ≤ 350** (조립/lifecycle hook만)
- `http-server.ts`: 643 → **목표 ≤ 250**
- `route-handler.ts`: 438 → **목표 ≤ 250**

---

### Phase 3 — CoreStep enum 교체 (F10)

단일 PR. `adapter-definition.ts`:
```ts
import { CoreStep } from '@zipbul/core';

export const adapterDefinition = defineAdapter({
  // ...
  pipeline: [
    HttpPhase.OnRequest,
    HttpStep.ResolveRoute,
    HttpPhase.BeforeParse,
    HttpStep.ParseBody,
    HttpPhase.BeforeValidate,
    CoreStep.Validation,     // was 'Validation'
    CoreStep.Guard,          // was 'Guard'
    HttpPhase.BeforeHandle,
    CoreStep.Handler,        // was 'Handler'
    HttpStep.WriteResponse,
    HttpPhase.AfterHandle,
    HttpStep.Serialize,
    HttpPhase.BeforeResponse,
    HttpPhase.AfterResponse,
  ],
});
```

AOT 컴파일러 `['Handler','Guard','Validation']` 매칭 `[verified: config-extractor.ts:378]`은 enum 값이 동일 문자열이므로 동작 유지.

---

### Phase 4 — API 단정화 (개별 합의)

#### 4-1. 33개 미사용 에러 클래스 제거 (F11)
- 삭제 대상: `BadRequestError, UnauthorizedError, PaymentRequiredError, ForbiddenError, NotFoundError, MethodNotAllowedError, NotAcceptableError, ProxyAuthenticationRequiredError, RequestTimeoutError, ConflictError, GoneError, LengthRequiredError, PreconditionFailedError, RequestedRangeNotSatisfiableError, UnsupportedMediaTypeError, ExpectationFailedError, ImATeapotError, MisdirectedRequestError, LockedError, FailedDependencyError, UpgradeRequiredError, PreconditionRequiredError, TooManyRequestsError, RequestHeaderFieldsTooLargeError, UnavailableForLegalReasonsError, InternalServerError, NotImplementedError, BadGatewayError, ServiceUnavailableError, GatewayTimeoutError, HTTPVersionNotSupportedError, InsufficientStorageError, NetworkAuthenticationRequiredError` (33개)
- 유지: `HttpError`, `RequestTooLongError`, `RequestUriTooLongError`, `UnprocessableEntityError` (4개)
- `errors/index.ts` 업데이트.
- Public API 영향 없음 (`packages/http-adapter/index.ts:28`는 `HttpError`만 re-export) `[verified]`.
- **Deprecation 절차**: deep import 위험 고려해 1 minor version 동안 `@deprecated` 주석 후 다음 minor에서 삭제.

#### 4-2. `HttpRequest` readonly 전환 (F5, F6)
**개별 합의 필요**. 3개 안:
- (A) `enums.ts:20` 주석의 "method override, URL rewriting" 의도 폐기 → 주석 삭제 + `method/url/path/query` readonly 전환.
- (B) 설계 의도 유지 → mutable 그대로.
- (C) 중간안 — `private` + typed setter (`setMethod`, `setUrl`, `setPath`, `setQuery`). 재할당은 명시적으로만.

**저자 권고**: C — 문서 의도 보존 + 재할당 추적성 확보.

#### 4-3. `decorators/method-option.decorator.ts` 7개 분할 (F20)
**선택사항**. 1 class 1 file 정책 엄격 적용 시 7개 `*.decorator.ts`로 분할. 기능상 무관.

---

### Phase 5 — 최종 정비

#### 5-1. Test-only `__internals` 심볼 분리 (F7)
- 6개 test-only 심볼 각자 모듈에서 이미 export 중 → spec 파일이 `__internals` 대신 직접 import로 전환.
- 완료 후 `__internals`에서 6개 심볼 제거 → 18개(runtime) + proxy/* spread만 남음.

#### 5-2. 테스트 분산
- `http-adapter.spec.ts`(4506 LOC)의 parseBody/writeError/writeSuccess 케이스를 각 추출 모듈 spec으로 이동.
- 통합 시나리오는 `http-adapter.spec.ts`에 잔존.

#### 5-3. 정합성 확인
- knip/oxlint/`bun run deps` clean.
- `packages/http-adapter/index.ts` public facade 유지 (내부 서브디렉토리 비공개).

---

## 6. 실행 순서 (엄수)

```
Phase 0 (안전망)
  ├── 0-1 coverage
  ├── 0-2 테스트 보강 (ipv6ToBytes/matchesPrefix/F12/F13)
  └── 0-3 ClassMetadata.methods 확정 (이미 F2에서 완료)
   ▼
Phase 1 (저위험)
  ├── 1-1 errors.ts 삭제 (독립 PR)
  ├── 1-2a~e 타입 SSOT 통일 (5 독립 PR)
  ├── 1-3 _status 센티넬 (독립 PR)
  ├── 1-4 F12 setBody 버그 (독립 PR)
  └── 1-5 F13 fire-and-forget 명시화 (독립 PR)
   ▼
Phase 2 (서브시스템 추출, 하위 단계 병렬 가능)
  ├── 2-1 proxy/ (6 PR)
  ├── 2-2 body/ (3 PR)
  ├── 2-3 response-writer/ (1 PR)
  ├── 2-4 route-options/ (1 PR)
  ├── 2-5 pipeline/router-register (1 PR)
  ├── 2-6 metadata/ (1 PR)
  └── 2-7 pipeline/adapter-step-fns (1 PR, 마지막 권장)
   ▼
Phase 3 — CoreStep 교체 (1 PR)
   ▼
Phase 4 (선택적, 개별 합의)
  ├── 4-1 33개 에러 제거 (1 PR)
  ├── 4-2 HttpRequest readonly 전환 (합의 후 1 PR)
  └── 4-3 decorators 분할 (선택, 1 PR)
   ▼
Phase 5 — 최종 정비
  ├── 5-1 test-only __internals 직접 import 전환
  ├── 5-2 spec 분산
  └── 5-3 knip/oxlint/deps clean
```

**총 PR 추정**: 약 24~27개. 대부분 ≤ 200 LOC 변경.

---

## 7. 알고리즘 최적화 Phase (선택적, Phase 2와 병렬 가능)

`[agent-verified: 2차 알고리즘 최적화 에이전트]`.

### Opt-1. `ipv6ToBytes` 불변성 + split 중복 제거
`[verified: http-server.ts:300-342]`
- 변수 `ip` 재할당 제거 → `processedIp` local 사용.
- `split('::')` + left/right `split(':')` 각 1회로 단일화.
- `parseHexGroups` 헬퍼 추출.
- **정확성/가독성 개선. 성능 주장 없음 (측정 필요)**.

### Opt-2. `parseBody`의 TextDecoder 싱글톤
`[verified: http-adapter.ts:436, 461, 487, 522]`
- `UTF8_FATAL_DECODER = new TextDecoder('utf-8', { fatal: true })` 모듈 상수.
- charset이 `utf-8`/`UTF-8`이면 싱글톤 재사용, 아니면 lazy cache.
- JSON charset 체크(`http-adapter.ts:434-448`)를 `charset === 'utf-8' || charset === 'UTF-8'` 문자열 비교로 단순화 (현재 `new TextDecoder` 생성 후 `.encoding` 검사).

### Opt-3. `HttpResponse` 상태 머신 명시화
`[verified: http-response.ts 전체]`
- 11개 private 필드의 암시적 상태를 명시 enum으로:
  ```ts
  type ResponseState = 'Init' | 'Buffered' | 'Serialized' | 'NativeSet' | 'Sent';
  ```
- `transitionTo(state)` 헬퍼로 상태 전이 중앙화.
- F12 버그가 상태 머신 부재의 결과이므로 Phase 1-4 이후 구조적 재발 방지.
- **Public API 불변, 내부 구조만 재정렬**.

### Opt-4. `writeSuccessResponse` pull callback factory
`[verified: http-adapter.ts:717-800]`
- SSE/raw formatter를 module-level 함수(`formatRawChunk`, 기존 `formatSSEChunk`)로.
- `createAsyncIterablePullFactory(iterator, signal, formatter)` 팩토리로 중첩 closure 축소.
- `signal.aborted` 체크 3회 → 2회로 정리.

### Opt-5. `resolveClientIp` normalizeIp 중복 제거
`[verified: http-server.ts:204-224]`
- socket IP 루프 진입 시점 1회 정규화, 이후 chain IP는 루프 내 정규화.
- `isTrustedIpNormalized(ip, config, hopIndex)` 신설 — 이미 정규화된 IP에 대한 평가.
- 기존 `isTrustedIp`는 호환 유지 (normalizeIp 호출 후 위임).

**Opt Phase 조건**: Phase 2 완료 후 또는 2-1/2-2와 병렬 가능. 각 Opt는 독립 PR, 벤치마크가 포함된 경우 mitata 결과 첨부.

---

## 8. 위험 매트릭스

| Phase | 위험 | 완화 |
|-------|-----|------|
| 0-2 | F12/F13 테스트가 실제 버그를 잡지 못함 | 수정 **전** fail 확인 규정 |
| 1-2 | core 타입 삭제 시 downstream 빌드 실패 | 5개 독립 PR, CI 격리 검증 |
| 1-3 | `_status` 변경이 외부 테스트 깨뜨림 | 31+ 지점 `[agent-verified]` 확인 완료 |
| 1-4/1-5 | setBody/cancel 수정이 다른 테스트 깨뜨림 | 전체 `http-response.spec.ts` 회귀 |
| 2-1 | `__internals` 객체 구조 변경 → 테스트 깨짐 | proxy/* spread로 외부 shape 유지 |
| 2-2 | parseBody 3분기 오변형 | 통합 금지 명문화, 원본 분기 유지 |
| 2-7 | adapter-step-fns deps 인터페이스 누락 | AdapterStepDeps 인터페이스 + 단위 테스트 |
| 3 | CoreStep 교체 AOT 매칭 실패 | 값이 동일 문자열 `[verified]`, 안전 |
| 4-1 | deep import 사용자 존재 시 빌드 깨짐 | 1 minor deprecation |
| 4-2 | 문서 의도 위반 | 안 A/B/C 개별 합의 |
| Opt-3 | 상태 머신 재설계가 버그 유발 | Phase 1-4 이후에만 착수, 회귀 전수 |

---

## 9. 완료 판정 기준

| 지표 | 현재 `[verified]` | 목표 | 판정 기준 |
|------|-----------------|------|---------|
| `http-adapter.ts` LOC | 898 | ≤ 350 | `wc -l` 실측 |
| `http-server.ts` LOC | 643 | ≤ 250 | `wc -l` 실측 |
| `route-handler.ts` LOC | 438 | ≤ 250 | `wc -l` 실측 |
| core 완전 중복 타입 | 4 (F2 중 identical 2 + partial 2 + DecoratorArgument) | 0 completed + 확장 문서화 | Phase 1-2 완료 |
| F12 버그 | 미수정 | 수정 + 회귀 테스트 | Phase 1-4 |
| F13 unhandled rejection | 미명시 | `.catch` 명시 | Phase 1-5 |
| `__internals` export | 24 | 18 + proxy/* spread | Phase 2-1, 5-1 |
| `parseBody` 분기 구조 | 3분기 혼재 | 3분기 보존, 파일만 이동 | Phase 2-2 |
| 에러 클래스 수 | 38 (HttpError + 37) | 4 (HttpError + 3 used) | Phase 4-1 |
| `adapter-definition.ts` 문자열 리터럴 | 3개 (`'Validation'`, `'Guard'`, `'Handler'`) | `CoreStep.X` | Phase 3 |
| `ipv6ToBytes`/`matchesPrefix` 단위 테스트 | 없음 | 추가 완료 | Phase 0-2 |
| 전체 테스트 pass | baseline | 동일 + 보강 | CI |
| knip/oxlint/`bun run deps` | clean `[unverified: 현재 상태]` | clean 유지 | CI |

---

## 10. 부록 — 변경하지 않는 것

명시적 현상 유지:

1. **`HttpContext.to()`** — `AdapterContext` 인터페이스 계약 `[verified: F19]`.
2. **`wrapValidationError`의 baker 결합** — core 자체가 baker에 결합 `[verified: F18]`. 제거는 core 수정 동반.
3. **`server-sent-event.ts` 파일 구조** — 응집력 충분 `[verified: F21]`.
4. **`decorators/` 7개 no-op 한 파일** — 기능상 무관, 정책 선택 `[verified: F20]`. Phase 4-3 선택적.
5. **`parseBody`의 3분기 구조** — CL fast path의 Bun 특화 동작 보존 `[reason: adversarial 반증]`.
6. **AOT 컴파일러 인터페이스** — 문자열 매칭 방식 유지, http-adapter는 소비자.

---

## 11. 문서 관리

본 문서는 **살아있는 계획 문서**. 각 Phase 완료 후 해당 섹션에 실제 결과(wc -l 실측, PR 번호, 회귀 검증 결과) 갱신. 새 사실이 발견되면 해당 Finding에 `[verified: ...]` 태그 유지하며 업데이트.

`[unverified]` 태그가 다시 등장하지 않도록 변경 전 반드시 검증 선행.
