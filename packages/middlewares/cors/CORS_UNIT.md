# CORS 유닛테스트 계약 기반 계획 (v3)

이 문서는 `packages/middlewares/cors/src/`의 유닛테스트를 **계약 우선(contract-first)**으로 재도출한 계획이다. 기존 spec/구현은 사실로 취급하지 않고, Fetch Standard·RFC·공개 API 계약에서 케이스를 먼저 뽑은 뒤 (a) 구현 정합성과 (b) 테스트 커버리지를 각각 매핑한다.

**v2 → v3 변경점 (2차 크로스리뷰 반영)**:
- **산수 정정**: 영역별 직접 합산. raw 120 (신규 케이스 3건 반영) − 1 dup − 4 NON_FEATURE = **유효 115**.
- **갭 합계 정정**: **46** (영역별 직접 합).
- **커버리지**: 69/115 ≈ **60.0%**.
- **구현 정합성**: 112/115 ≈ 97.4% (3건 SPEC_DRIFT 유지).
- **C-OR-7~9 출처 정정**: `FS-OH §3.2` 단독 → "raw 헤더 robustness 입력 (spec 적합 클라이언트는 opaque origin을 `null`로 직렬화 — RFC 6454 §4, §6)".
- **R6454 lowercase 근거 정정**: §6 → §4 (origin 생성 알고리즘). §6은 직렬화만.
- **§3.3a 신설 선언 철회**: §3.3 안에 묶음 처리.
- **PNA 절번호 안정성 단서 추가**: "WICG draft, 절번호 변동 가능".
- **C-OPT-21 `safe()` 시그니처 검증**: `packages/libs/result/src/safe.ts:75-83` 직접 인용으로 외부 패키지 가정 명시화.
- **신규 케이스 추가**: C-CK-1 (Reject 경로 ACAO 부재 → 클라이언트 차단), C-PF-22 (credentials=true + `ACAH: *` + Authorization 외 임의 헤더), C-PN-7 (PNA client-side trigger는 서버 의무 외 명시).
- **§4.8 step 번호 매핑 회피**: 명시적 trade-off 선언 (Living Standard 변동 빈도).

## 0. 스코프

- 패키지: `packages/middlewares/cors`
- 소스: `src/cors.ts`, `src/options.ts`, `src/middleware.ts`, `src/interfaces.ts`, `src/types.ts`, `src/enums.ts`, `src/constants.ts`
- 테스트 tier: **유닛만** — 콜로케이트 `src/*.spec.ts`만 대상. `packages/middlewares/cors/test/` 디렉터리는 본 계획의 스코프 밖.
- 도출 방법: 계약 → 케이스 → 구현 매핑 → 테스트 매핑 → 갭

## 1. 계약 출처 (절번호 검증 완료)

Fetch Standard는 Living Standard로 2026-05 시점에 https://fetch.spec.whatwg.org/ 의 ToC를 WebFetch로 직접 확인. PNA는 WICG draft로 절 번호가 변동 가능 — 본 문서는 헤더 이름 + 값 규칙에 의존하지 출처 절번호에는 강하게 의존하지 않음.

| ID | 출처 | 절 |
|---|---|---|
| FS-OH | Fetch Standard | §3.2 Origin header |
| FS-CP | Fetch Standard | §3.3 CORS protocol (전체) |
| FS-RQ | Fetch Standard | §3.3.2 HTTP requests |
| FS-RP | Fetch Standard | §3.3.3 HTTP responses |
| FS-CR | Fetch Standard | §3.3.5 CORS protocol and credentials |
| FS-EX | Fetch Standard | §3.3.7 CORS protocol exceptions (simple/safelisted request) |
| FS-SH | Fetch Standard | §2.2.2 CORS-safelisted request-header / response-header / non-wildcard |
| FS-PF | Fetch Standard | §4.8 CORS-preflight fetch |
| FS-PC | Fetch Standard | §4.9 CORS-preflight cache |
| FS-CK | Fetch Standard | §4.10 CORS check |
| R6454-O | RFC 6454 | §4 Origin of a URI (생성 알고리즘 — lowercase host/scheme 포함) |
| R6454-S | RFC 6454 | §6 ASCII Serialization (디폴트 포트 생략 MUST) |
| R9110-T | RFC 9110 | §5.6.2 token, §9.1 method, §5.1 field-name |
| R9110-V | RFC 9110 | §12.5.5 Vary |
| R9111 | RFC 9111 | §1.2.2 delta-seconds (maxAge) |
| PNA | WICG Private Network Access | 헤더 `Access-Control-Request/Allow-Private-Network`, 값 `'true'` (case-sensitive) |
| API | `src/interfaces.ts` `CorsOptions` JSDoc | 공개 옵션 계약 |
| API-Fn | `src/types.ts` `OriginFn` | Origin 함수 반환 계약 |
| API-Mw | `src/middleware.ts` | 미들웨어가 어댑터에 부착하는 계약 |

**§4.8 step 번호 매핑**: Fetch §4.8 알고리즘은 16+개 step이 있으나 Living Standard 변동성 + 본 계획의 안정성 요구로 step ordinal에 의존하지 않음. 케이스는 입력→기대 결과로만 정의.

## 2. 케이스 표기 규약

- ID: `C-<area>-<n>`
- 타입: **EP-V** / **EP-I** / **BVA** / **EX** / **REACH**
- 컬럼: ID · 출처 · 타입 · 입력 · 기대 · 구현(`cors.ts:line` 또는 `NOT_IMPL`) · 테스트(`cors.spec.ts:line` 또는 `GAP`) · 비고
- 비고 코드:
  - `SPEC_DRIFT`: 구현이 계약 어김
  - `NON_FEATURE`: spec이 서버에 강제 안 함
  - `TEST_DRIFT`: 테스트가 계약 아닌 구현을 잠금
  - `UNREACH`: 도달불가
  - `OBS`: observability 결여
  - `MULTI_PKG`: 패키지 경계 결함
  - `ROBUSTNESS`: spec 외 raw 입력 방어

## 3. 케이스 카탈로그

### 3.1 Origin 헤더 읽기 (FS-OH §3.2 / FS-CK §4.10 / R6454-O §4)

| ID | 출처 | 타입 | 입력 | 기대 | 구현 | 테스트 | 비고 |
|---|---|---|---|---|---|---|---|
| C-OR-1 | FS-OH | EP-V | `Origin: https://a.com` | `matchOrigin` 진입 | `cors.ts:46-52` | `cors.spec.ts:110, 134` | |
| C-OR-2 | FS-OH | EP-I | `Origin` 헤더 부재 | `Reject(NoOrigin)` | `cors.ts:48-50` | `cors.spec.ts:85-94` | |
| C-OR-3 | FS-OH / R6454-S | EP-I | `Origin: ` (빈 문자열) | `Reject(NoOrigin)` | `cors.ts:48-50` | `cors.spec.ts:96-105` | |
| C-OR-4 | R6454-S §6 | EP-V | `Origin: null` (opaque origin 직렬화) | 정책 결정 사안 — 옵션이 string `'null'`이면 raw 매칭 | `cors.ts:156-158` | **GAP** | 옵션 `'null'` 의미 미정의. |
| C-OR-5 | R6454-S §6 | EP-V | `Origin: http://a.com:80` (디폴트 포트 명시 — 비표준 클라이언트) | tuple 동치성 (디폴트 포트 생략 MUST) | `cors.ts:156-158` raw 동등성 | **GAP** | `SPEC_DRIFT` 후보. R6454 §6은 디폴트 포트 생략을 MUST로 규정하지만 클라이언트가 위반해 보낼 경우 서버 정규화 의무는 약함. |
| C-OR-6 | R6454-O §4 | EP-V | `Origin: HTTPS://A.COM` (대소문자 — 비표준 클라이언트) | scheme/host lowercase 직렬화 | `cors.ts:156-158` raw 동등성 | **GAP** | 동일. R6454 §4 origin 생성 알고리즘이 lowercase를 강제. |
| C-OR-7 | ROBUSTNESS | EP-V | `Origin: file://` (spec 적합 클라이언트는 `null`로 직렬화) | 정책 결정 사안 | `cors.ts:156-158` raw 매칭 | **GAP** | spec 외 raw 입력 — 옵션 명세 부재. |
| C-OR-8 | ROBUSTNESS | EP-V | `Origin: data:,` | 동일 | `cors.ts:156-158` | **GAP** | |
| C-OR-9 | ROBUSTNESS | EP-V | `Origin: blob:https://a.com/uuid` | 동일 | `cors.ts:156-158` | **GAP** | |

### 3.2 Origin 옵션 형태별 (API / API-Fn)

| ID | 출처 | 타입 | 옵션 | 기대 | 구현 | 테스트 | 비고 |
|---|---|---|---|---|---|---|---|
| C-OPT-1 | API | EP-V | `'*'` | ACAO=`*` | `cors.ts:152-153` | `cors.spec.ts:107-116` | |
| C-OPT-2 | API | EP-V | `false` | Reject(OriginNotAllowed) | `cors.ts:148-150` | `cors.spec.ts:166-175` | |
| C-OPT-3 | API | EP-V | `true` | ACAO=요청 origin (reflect) | `cors.ts:160-162` | `cors.spec.ts:155-164` | |
| C-OPT-4 | API | EP-V | string match | ACAO=옵션 | `cors.ts:156-158` | `cors.spec.ts:131-142` | |
| C-OPT-5 | API | EP-I | string no-match | Reject | `cors.ts:156-158` | `cors.spec.ts:144-153` | |
| C-OPT-6 | API | EP-V | RegExp match | ACAO=요청 origin | `cors.ts:164-167` | `cors.spec.ts:177-185` | |
| C-OPT-7 | API | EP-I | RegExp no-match | Reject | `cors.ts:164-167` | `cors.spec.ts:187-195` | |
| C-OPT-8 | API | REACH | RegExp `/g` 두 번 호출 | lastIndex 격리 | `cors.ts:165` `lastIndex = 0` | `cors.spec.ts:197-208` | |
| C-OPT-9 | API | EP-V | 순수 문자열 배열 | 첫 매치 | `cors.ts:169-180` | **GAP** | |
| C-OPT-10 | API | EP-V | 혼합 배열 (RegExp 실패 → 문자열 매치) | `.some()` 순회 매치 | `cors.ts:170-177` | **GAP** | 순서 의존 경로. |
| C-OPT-11 | API | REACH | 배열 + `/g` RegExp 두 번 호출 | lastIndex 격리 | `cors.ts:172` | `cors.spec.ts:210-221` | |
| C-OPT-12 | API | EP-I | 모든 배열 엔트리 미매치 | Reject | `cors.ts:179` | `cors.spec.ts:246-254` | |
| C-OPT-13 | API-Fn | EP-V | OriginFn 동기 `true` | ACAO=요청 origin | `cors.ts:182-194` | `cors.spec.ts:256-266` | |
| C-OPT-14 | API-Fn | EP-V | OriginFn 동기 `string` | ACAO=반환값 | `cors.ts:182-194, 202-203` | `cors.spec.ts:268-277` | |
| C-OPT-15 | API-Fn | EP-V | OriginFn 동기 `false` | Reject | `cors.ts:182-194, 206` | `cors.spec.ts:279-287` | |
| C-OPT-16 | API-Fn | EP-V | OriginFn 비동기 `Promise<true>` | ACAO=요청 origin | `cors.ts:183` `await` | **GAP** | |
| C-OPT-17 | API-Fn | EP-V | OriginFn 비동기 `Promise<string>` | ACAO=반환값 | `cors.ts:183` | **GAP** | |
| C-OPT-18 | API-Fn | EX | OriginFn 동기 throw | `throw CorsError(OriginFunctionError)` | `cors.ts:182-191` | `cors.spec.ts:289-302` | try/catch 안티패턴. |
| C-OPT-19 | API-Fn | EX | OriginFn 비동기 reject | `throw CorsError(OriginFunctionError)` | `cors.ts:182-191` | **GAP** | |
| C-OPT-20 | API-Fn | EP-I | OriginFn 빈 문자열 반환 | Reject (length 0 → undefined) | `cors.ts:202-203` | **GAP** | |
| C-OPT-21 | API-Fn | OBS | OriginFn throw 시 원본 `cause` 보존 | `CorsError.cause = originalError` | `cors.ts:182-188` mapper가 0-arity로 thrown 무시 | **GAP** | `SPEC_DRIFT`. `safe()` mapper 시그니처는 `(thrown: unknown) => E` 지원(`packages/libs/result/src/safe.ts:75-83`)이지만 cors는 `(): CorsErrorData` 형태. |

### 3.3 Non-preflight 응답 헤더 (FS-CK §4.10 / FS-RP §3.3.3 / FS-EX §3.3.7)

§4.10 CORS check는 메인 요청 응답에 대한 알고리즘. §3.3.7은 simple request preflight 면제(클라이언트 결정). 본 절은 OPTIONS가 아닌 정상 요청 응답 헤더 부착을 검증.

| ID | 출처 | 타입 | 조건 | 기대 헤더 | 구현 | 테스트 | 비고 |
|---|---|---|---|---|---|---|---|
| C-AO-1 | FS-RP §3.3.3 | EP-V | origin=`'*'`, credentials=false | `ACAO: *` | `cors.ts:64` | `cors.spec.ts:115` | |
| C-AO-2 | FS-CR §3.3.5 | EX | origin=`'*'` + credentials=true | `Cors.create` throw | `options.ts:125-130` | `cors.spec.ts:69-79` | **C-V-8 중복** (1쌍 → 집계 시 1건). |
| C-AO-3 | FS-RP §3.3.3 | EP-V | string 매치 | `ACAO: https://a.com` | `cors.ts:64` | `cors.spec.ts:140` | |
| C-AO-4 | R9110-V §12.5.5 | EP-V | non-wildcard ACAO | `Vary: Origin` 동반 | `cors.ts:66-68` | `cors.spec.ts:141` (`toContain`) | C-AO-3와 분리 단언 권장 (현재 한 테스트에 동시 — `TEST_DRIFT`). |
| C-AO-5 | FS-RP §3.3.3 | EP-V | reflect (`origin: true`) | `ACAO: <req origin>` + `Vary: Origin` | `cors.ts:64-68` | `cors.spec.ts:155-164` | Vary 단언 누락. |
| C-CK-1 | FS-CK §4.10 | EP-V | Reject 경로 시 응답 헤더 부재 | 미들웨어가 `Continue` 미생성 → 다음 미들웨어 위임, ACAO 부재로 클라이언트 차단 | `cors.ts:49, 59, 94, 108` reject 경로 + `middleware.ts:36-38` silent return | **GAP** | §4.10 관점의 묶음 검증 케이스 부재. |

### 3.4 ACAC (credentials) (FS-CR §3.3.5 / FS-SH §2.2.2)

| ID | 출처 | 타입 | 조건 | 기대 | 구현 | 테스트 | 비고 |
|---|---|---|---|---|---|---|---|
| C-AC-1 | FS-CR | EP-V | credentials=true + non-wildcard origin | `ACAC: true` | `cors.ts:70-72` | `cors.spec.ts:308-317` | |
| C-AC-2 | FS-CR | EP-V | credentials=false | `ACAC` 헤더 부재 | `cors.ts:70-72` | **GAP** | 부정 단언 0건. |
| C-AC-3 | FS-SH §2.2.2 | EP-I | credentials=true + `ACAH: *` + 요청 `Authorization` (explicit 없음) | preflight reject | `cors.ts:253-257` | `cors.spec.ts:458-467` | |

### 3.5 ACEH (expose-headers) (FS-RP §3.3.3 / FS-SH §2.2.2)

| ID | 출처 | 타입 | 조건 | 기대 | 구현 | 테스트 | 비고 |
|---|---|---|---|---|---|---|---|
| C-EH-1 | FS-RP | EP-V | non-preflight + exposedHeaders 명시 | `ACEH: a,b` | `cors.ts:75-81` | `cors.spec.ts:323-332` | |
| C-EH-2 | FS-RP | EP-V | exposedHeaders=`['*']` + credentials=false | `ACEH: *` (`cors.ts:216` 폴스루 join) | `cors.ts:209-217` | **GAP** | 구현 OK·테스트 GAP. |
| C-EH-3 | FS-RP | EP-V | exposedHeaders=`['*']` + credentials=true | `ACEH` 미설정 (와일드카드 무효, explicit 없음 → undefined) | `cors.ts:210-214` | `cors.spec.ts:334-343` | |
| C-EH-4 | FS-RP | EP-V | exposedHeaders=`['*', 'X']` + credentials=true | `ACEH: X` (explicit만) | `cors.ts:210-214` | `cors.spec.ts:345-365` | |
| C-EH-5 | FS-RP | EP-V | exposedHeaders=`['X']` + credentials=true | `ACEH: X` (와일드카드 없음 폴스루) | `cors.ts:216` | **GAP** | |
| C-EH-6 | FS-RP | EP-V | preflight (OPTIONS + ACRM) | `ACEH` 미설정 | `cors.ts:74` 조건 | **GAP** | 부정 단언 없음. |
| C-EH-7 | FS-SH §2.2.2 | NON_FEATURE | 기본 노출 7헤더 (`Cache-Control`, `Content-Language`, `Content-Length`, `Content-Type`, `Expires`, `Last-Modified`, `Pragma`) | 클라이언트 자동 노출 | NOT_IMPL (서버 책임 외) | N/A | |

### 3.6 Preflight 알고리즘 (FS-PF §4.8 / FS-EX §3.3.7)

§4.8 step ordinal 매핑은 회피 (Living Standard 변동성). 케이스는 입력→기대로만 정의.

| ID | 출처 | 타입 | 조건 | 기대 | 구현 | 테스트 | 비고 |
|---|---|---|---|---|---|---|---|
| C-PF-1 | FS-PF | EP-V | OPTIONS + ACRM 부재 | non-preflight으로 처리 (Continue) | `cors.ts:86-90` | `cors.spec.ts:371-379` | |
| C-PF-2 | FS-PF | EP-I | OPTIONS + `ACRM: ` (빈 값) | non-preflight (length=0 short-circuit) | `cors.ts:86-90` | **GAP** | |
| C-PF-3 | FS-PF | EP-V | ACRM이 allowed methods에 포함 | `ACAM` 설정 | `cors.ts:92-98` | `cors.spec.ts:381-390` | ACAM 값 단언 없음. |
| C-PF-4 | FS-PF | EP-I | ACRM이 allowed methods에 미포함 | Reject(MethodNotAllowed) | `cors.ts:92-94` | `cors.spec.ts:392-401` | |
| C-PF-5 | R9110-T §9.1 | EP-I | ACRM 소문자 (`get`) | Reject (method case-sensitive token) | `cors.ts:92, options.ts:23-25` | `cors.spec.ts:403-412` | |
| C-PF-6 | FS-PF | EP-V | ACRH 파싱 (쉼표 분리 + trim + 빈 토큰 필터) | trim 후 비교 | `cors.ts:102-103, 303-311` | **GAP** | `"X-A, , X-B"` 빈 토큰 미커버. |
| C-PF-7 | FS-PF | EP-V | allowedHeaders=null (echo mode) | `ACAH: <요청 ACRH 그대로>` | `cors.ts:116-121` | `cors.spec.ts:436-445` | |
| C-PF-8 | FS-PF | EP-V | 명시 allowedHeaders 매치 | `ACAH: <옵션 join>` | `cors.ts:105-115` | `cors.spec.ts:414-423` | |
| C-PF-9 | FS-PF | EP-I | 명시 allowedHeaders 미매치 | Reject(HeaderNotAllowed) | `cors.ts:106-108` | `cors.spec.ts:425-434` | |
| C-PF-10 | API | EP-V | allowedHeaders=`[]` + ACRH 동반 | Reject | `cors.ts:244-246` | **GAP** | |
| C-PF-11 | API | EP-V | allowedHeaders=`[]` + ACRH 부재 | Continue (요청 헤더 없음 → true) | `cors.ts:240-242` | **GAP** | |
| C-PF-12 | API | EP-V | 명시 allowedHeaders + ACRH 부재 | `ACAH` 미설정 (raw=null 폴스루) | `cors.ts:110-115` | **GAP** | |
| C-PF-13 | FS-SH §2.2.2 | NON_FEATURE | ACRH=safelisted (`Accept`/`Accept-Language`/`Content-Language`/`Content-Type`) | 클라이언트 측 preflight 트리거 결정 규칙 — 서버 의무 외 | NOT_IMPL | N/A | |
| C-PF-14 | FS-SH §2.2.2 | NON_FEATURE | ACRH=`Content-Type` MIME 화이트리스트 + byte length | 동일 | NOT_IMPL | N/A | |
| C-PF-15 | FS-SH §2.2.2 (non-wildcard) | EP-I | `ACAH: *` + ACRH=`Authorization` (explicit 없음) | Reject | `cors.ts:253-257` | `cors.spec.ts:458-467` | |
| C-PF-16 | FS-SH §2.2.2 | EP-V | `ACAH: ['*', 'Authorization']` + credentials=true + ACRH=`Authorization, X` | preflight 통과 | `cors.ts:255-269` | `cors.spec.ts:469-481` | |
| C-PF-17 | FS-SH §2.2.2 + R9110-T §5.1 | EP-V | `ACAH: *` + ACRH=`AUTHORIZATION` (대문자) | case-insensitive 매칭 | `cors.ts:253, 300` | **GAP** | |
| C-PF-18 | FS-PF / R9111 | EP-V | maxAge=86400 | `ACMA: 86400` | `cors.ts:123-125` | `cors.spec.ts:483-492` | |
| C-PF-19 | R9111 §1.2.2 | BVA | maxAge=0 | `ACMA: 0` | `cors.ts:123-125` | **GAP** | 직렬화 단언 없음 (옵션 검증은 C-V-14). |
| C-PF-20 | API | EP-V | preflightContinue=true | `Continue` + 모든 preflight 헤더 부착 | `cors.ts:134-136` | `cors.spec.ts:494-502` | 헤더 부착 단언 없음. |
| C-PF-21 | FS-PF | EP-V | preflight 응답 statusCode | `RespondPreflight` + statusCode | `cors.ts:138` | `cors.spec.ts:504-513` | |
| C-PF-22 | FS-CR §3.3.5 | EP-V | `ACAH: *` + credentials=true + ACRH=`X-Custom` (Authorization 외 임의 헤더) | preflight 통과 — `*`가 wildcard로 동작 | `cors.ts:259-269` | **GAP** | credentials=true 경로의 Authorization 외 헤더 처리 분기 미커버. |

### 3.7 ACAM 직렬화 (FS-RP §3.3.3)

| ID | 출처 | 타입 | 조건 | 기대 | 구현 | 테스트 | 비고 |
|---|---|---|---|---|---|---|---|
| C-AM-1 | FS-RP | EP-V | non-wildcard methods | `ACAM: <join>` | `cors.ts:228-229` | **GAP** | 값 단언 없음. |
| C-AM-2 | FS-RP | EP-V | wildcard + credentials=false | `ACAM: *` | `cors.ts:236` | `cors.spec.ts:530-539` | |
| C-AM-3 | FS-RP / FS-CR | EP-V | wildcard + credentials=true | `ACAM: <요청 method 그대로>` | `cors.ts:232-234` | `cors.spec.ts:519-528` | |

### 3.8 Vary (R9110-V §12.5.5)

| ID | 출처 | 타입 | 조건 | 기대 헤더 | 구현 | 테스트 | 비고 |
|---|---|---|---|---|---|---|---|
| C-VA-1 | R9110-V | EP-V | non-wildcard ACAO | `Vary: Origin` | `cors.ts:66-68` | `cors.spec.ts:141` | |
| C-VA-2 | R9110-V | EP-V | preflight method 처리 | `Vary` append `Access-Control-Request-Method` | `cors.ts:100` | **GAP** | |
| C-VA-3 | R9110-V | EP-V | preflight headers 처리 | `Vary` append `Access-Control-Request-Headers` | `cors.ts:114, 119` | **GAP** | |
| C-VA-4 | R9110-V | REACH | 같은 값 중복 append 안 함 | `Vary` 내 동일 값 중복 없음 | NOT_GUARANTEED | **GAP** | RFC 9110 §12.5.5 SHOULD. |
| C-VA-5 | R9110-V | EP-V | wildcard ACAO + credentials=false | `Vary: Origin` 부재 가능 | `cors.ts:66` skip | **GAP** | |

### 3.9 PNA (PNA spec / API)

PNA는 WICG draft — 절번호 변동성으로 헤더 이름+값 규칙에만 의존.

| ID | 출처 | 타입 | 조건 | 기대 | 구현 | 테스트 | 비고 |
|---|---|---|---|---|---|---|---|
| C-PN-1 | PNA | EP-V | allowPrivateNetwork=true + `ACRPN: true` | `ACAPN: true` | `cors.ts:127-132` | **GAP** | |
| C-PN-2 | PNA | EP-V | allowPrivateNetwork=true + `ACRPN` 부재 | `ACAPN` 미설정 | `cors.ts:127-132` | **GAP** | |
| C-PN-3 | PNA | EP-V | allowPrivateNetwork=true + `ACRPN: false` | `ACAPN` 미설정 | `cors.ts:129` raw 비교 | **GAP** | |
| C-PN-4 | PNA | EP-V | allowPrivateNetwork=false + `ACRPN: true` | `ACAPN` 미설정 | `cors.ts:127-132` | **GAP** | |
| C-PN-5 | PNA | EP-I | `ACRPN: TRUE` (대문자) | spec case-sensitive — 미매칭 | `cors.ts:129` `=== 'true'` strict | **GAP** | |
| C-PN-6 | API | EP-V | `resolveCorsOptions()` 기본값 `allowPrivateNetwork: false` | resolved.allowPrivateNetwork === false | `options.ts:32` | **GAP** | `options.spec.ts:13-20`이 8필드만 단언. |
| C-PN-7 | PNA | NON_FEATURE | PNA preflight trigger (public origin from secure context → private network target) | 클라이언트가 결정 — 서버 의무 외 | NOT_IMPL | N/A | |

### 3.10 옵션 검증

| ID | 출처 | 타입 | 입력 | 기대 | 구현 | 테스트 | 비고 |
|---|---|---|---|---|---|---|---|
| C-V-1 | API | EP-V | 기본값 (인자 없음) | `validateCorsOptions` 통과 | `options.ts:55-146` | `options.spec.ts:146-152` | |
| C-V-2 | R6454 | EP-I | origin=`''` | `InvalidOrigin` | `options.ts:56-61` | `options.spec.ts:356-364` | |
| C-V-3 | R6454 | EP-I | origin=`'  '` (blank) | `InvalidOrigin` | `options.ts:36-38, 56` | `options.spec.ts:366-384` | |
| C-V-4 | R6454 | EP-I | origin=`[]` | `InvalidOrigin` | `options.ts:71-76` | `options.spec.ts:386-394` | |
| C-V-5 | R6454 | EP-I | origin=`['']` | `InvalidOrigin` | `options.ts:78-85` | `options.spec.ts:396-414` | |
| C-V-6 | API | EX | origin=RegExp unsafe | `UnsafeRegExp` | `options.ts:63-68` (safe-regex2) | `options.spec.ts:720-749` | safe-regex2 정적 휴리스틱. |
| C-V-7 | API | EP-V | origin=RegExp safe | 통과 | `options.ts:63-68` | `options.spec.ts:657-709` | |
| C-V-8 | FS-CR §3.3.5 | EP-I | credentials=true + origin=`'*'` | `CredentialsWithWildcardOrigin` | `options.ts:125-130` | `options.spec.ts:164-173` | **C-AO-2 중복**. |
| C-V-9 | R9110-T | EP-I | methods=`[]` | `InvalidMethods` | `options.ts:97-102` | `options.spec.ts:475-483` | |
| C-V-10 | R9110-T | EP-I | methods=`['']` | `InvalidMethods` | `options.ts:104-109` | `options.spec.ts:485-513` | |
| C-V-11 | R9110-T | EP-I | allowedHeaders=`['']` | `InvalidAllowedHeaders` | `options.ts:111-116` | `options.spec.ts:544-572` | |
| C-V-12 | R9110-T | EP-I | exposedHeaders=`['']` | `InvalidExposedHeaders` | `options.ts:118-123` | `options.spec.ts:603-631` | |
| C-V-13 | R9111 | EP-I | maxAge=-1 | `InvalidMaxAge` | `options.ts:132-137` | `options.spec.ts:175-183` | |
| C-V-14 | R9111 | BVA | maxAge=0 | 통과 | `options.ts:132` | `options.spec.ts:245-252` | |
| C-V-15 | R9111 | EP-I | maxAge=1.5 | `InvalidMaxAge` | `options.ts:132` | `options.spec.ts:205-213` | |
| C-V-16 | R9111 | EP-I | maxAge=Infinity | `InvalidMaxAge` | `options.ts:132` | `options.spec.ts:215-223` | |
| C-V-17 | API | BVA | optionsSuccessStatus=200 | 통과 | `options.ts:139` | `options.spec.ts:254-261` | |
| C-V-18 | API | BVA | optionsSuccessStatus=199 | `InvalidStatusCode` | `options.ts:139` | **GAP** | 200 인접외측 미커버. |
| C-V-19 | API | BVA | optionsSuccessStatus=299 | 통과 | `options.ts:139` | `options.spec.ts:263-270` | |
| C-V-20 | API | BVA | optionsSuccessStatus=300 | `InvalidStatusCode` | `options.ts:139` | `options.spec.ts:195-203` | |
| C-V-21 | API | EP-I | optionsSuccessStatus=NaN | `InvalidStatusCode` | `options.ts:139` | `options.spec.ts:635-643` | message 단언 부재 (다른 invalid status 테스트도 동일 — 일관성 갭). |
| C-V-22 | API | EP-I | optionsSuccessStatus=200.5 | `InvalidStatusCode` | `options.ts:139` | `options.spec.ts:645-653` | |
| C-V-23 | API | REACH | 다중 위반 시 첫 실패 보고 | 첫 오류만 | `options.ts:56-146` | `options.spec.ts:281-307, 803-840` | `V1/V2/V3` 라벨 구현어휘 누출 — `TEST_DRIFT`. |

### 3.11 resolveCorsOptions

| ID | 출처 | 타입 | 입력 | 기대 | 구현 | 테스트 | 비고 |
|---|---|---|---|---|---|---|---|
| C-R-1 | API | EP-V | 인자 없음 | 9개 필드 모두 디폴트 | `options.ts:20-33` | `options.spec.ts:9-21` (8필드만) | `allowPrivateNetwork` 단언 누락. |
| C-R-2 | API | EP-V | methods 미지정 | `CORS_DEFAULT_METHODS` 사용 | `options.ts:23-25` | `options.spec.ts:9-21` | |
| C-R-3 | API | EP-V | methods 소문자 | 모두 uppercase | `options.ts:25` | `options.spec.ts:87-99` | |
| C-R-4 | API | EP-V | methods에 `*` 포함 | `['*']`로 축약 | `options.ts:23-24` | `options.spec.ts:122-127` | |
| C-R-5 | API | REACH | 입력 배열 referential immutability | 호출 후 입력 배열 변형 없음 | `options.ts:25` `.map` 새 배열 | **GAP** | |
| C-R-6 | API | EP-V | 명시 `methods: undefined` | 디폴트 사용 | `options.ts:25` `??` | **GAP** | 인자 없음과 별개 EP. |

### 3.12 Middleware 통합 (API-Mw)

`src/middleware.spec.ts` 파일 부재 (`ls src/` 직접 확인) — 전체 갭.

| ID | 출처 | 타입 | 조건 | 기대 | 구현 | 테스트 | 비고 |
|---|---|---|---|---|---|---|---|
| C-MW-1 | API-Mw | EP-V | 유효한 opts | `MiddlewareDefinition` 반환 | `middleware.ts:28-31` | **GAP** | |
| C-MW-2 | API-Mw | EX | 무효한 opts | `Cors.create` throw 전파 | `middleware.ts:29` | **GAP** | |
| C-MW-3 | API-Mw | EP-V | `ctx.rawRequest === undefined` | 미들웨어 조기 종료 | `middleware.ts:33-34` | **GAP** | |
| C-MW-4 | API-Mw | EP-V | `CorsAction.Reject` | 조기 종료 (응답 미수정) | `middleware.ts:38` | **GAP** | silent drop. |
| C-MW-5 | API-Mw | EP-V | `CorsAction.RespondPreflight` | `setStatus + setHeader 전체 + ContentLength:0 + send()` | `middleware.ts:42-49` | **GAP** | |
| C-MW-6 | API-Mw | MULTI_PKG | `statusCode` enum 불일치 | `optionsSuccessStatus: 209` 통과 후 `HttpStatus` enum 미존재 값 setStatus | `middleware.ts:43` `as SetStatusArg` | **GAP** | `@zipbul/shared` HttpStatus 2xx: 200-208, 226만 (`packages/libs/shared/src/enums/http-status.ts:15-24` 확인). CORS 단독 결함 아님. |
| C-MW-7 | API-Mw | EP-V | `CorsAction.Continue` Vary 헤더 | `appendHeader` 사용 | `middleware.ts:53-58` | **GAP** | |
| C-MW-8 | API-Mw | EP-V | `CorsAction.Continue` 비-Vary 헤더 | `setHeader` 사용 | `middleware.ts:57` | **GAP** | |

## 4. 갭 집계

**유효 케이스 산식**: raw 120 − 1(C-AO-2 ≡ C-V-8 중복쌍) − 4(NON_FEATURE: C-EH-7, C-PF-13, C-PF-14, C-PN-7) = **유효 115**.

영역별 유효 케이스 / 테스트 OK / 갭:

| 영역 | raw | 차감 | 유효 | 테스트 OK | 갭 |
|---|---|---|---|---|---|
| 3.1 Origin 헤더 (9) | 9 | 0 | 9 | 3 | 6 |
| 3.2 Origin 옵션 (21) | 21 | 0 | 21 | 14 | 7 |
| 3.3 Non-preflight 응답 (6: AO-1~5 + CK-1) | 6 | 1 dup | 5 | 4 | 1 |
| 3.4 ACAC (3) | 3 | 0 | 3 | 2 | 1 |
| 3.5 ACEH (7) | 7 | 1 NON_FEAT | 6 | 3 | 3 |
| 3.6 Preflight (22: PF-1~22) | 22 | 2 NON_FEAT | 20 | 14 | 6 |
| 3.7 ACAM (3) | 3 | 0 | 3 | 2 | 1 |
| 3.8 Vary (5) | 5 | 0 | 5 | 1 | 4 |
| 3.9 PNA (7: PN-1~7) | 7 | 1 NON_FEAT | 6 | 0 | 6 |
| 3.10 옵션 검증 (23) | 23 | 0 | 23 | 22 | 1 |
| 3.11 resolveCorsOptions (6) | 6 | 0 | 6 | 4 | 2 |
| 3.12 Middleware (8) | 8 | 0 | 8 | 0 | 8 |
| **합계** | **120** | **5** | **115** | **69** | **46** |

산수 재검증: 9+21+6+3+7+22+3+5+7+23+6+8 = 120. 차감 5 (dup 1 + NON_FEAT 4). 유효 = 115. 테스트 OK 합 = 3+14+4+2+3+14+2+1+0+22+4+0 = 69. 갭 합 = 6+7+1+1+3+6+1+4+6+1+2+8 = 46. 69+46 = 115 ✓.

**최종 집계**:
- 유효 케이스: **115**
- 테스트 OK: **69**
- 갭: **46**
- 커버리지: 69/115 ≈ **60.0%**
- 구현 정합성: 112/115 ≈ **97.4%** (3건 SPEC_DRIFT)

## 5. SPEC_DRIFT 후보 (3건)

| 케이스 | 근거 |
|---|---|
| C-OR-5 | R6454 §6 ASCII 직렬화 디폴트 포트 생략 MUST 미적용 (raw 비교). |
| C-OR-6 | R6454 §4 origin 생성 lowercase 미적용 (raw 비교). |
| C-OPT-21 | `safe()` mapper API가 thrown 전달 지원(`packages/libs/result/src/safe.ts:75-83` `mapErr: (thrown: unknown) => E`)이지만 cors는 0-arity 정의로 cause 손실. |

## 6. NON_FEATURE (4건)

| 케이스 | 근거 |
|---|---|
| C-EH-7 | Fetch §2.2.2 기본 노출 7헤더는 클라이언트 자동 노출 — 서버 명시 의무 없음. |
| C-PF-13 | Fetch §2.2.2 safelisted 이름은 클라이언트 측 preflight 트리거 결정 규칙. |
| C-PF-14 | Fetch §2.2.2 `Content-Type` MIME 화이트리스트 + byte length 동일. |
| C-PN-7 | PNA preflight trigger는 클라이언트 결정. |

## 7. MULTI_PKG (1건)

C-MW-6 — `@zipbul/shared` HttpStatus enum + `@zipbul/http-adapter` setStatus 시그니처 결함. CORS 단독 책임 아님.

## 8. 테스트 결함 (skill 룰 위반 + TEST_DRIFT)

- try/catch + 외부 단언 (`cors.spec.ts:69-79, 289-302`) — skill anti-pattern row 7.
- 한 test에 다중 단언 (`cors.spec.ts:137-142`) — ACAO 값 + Vary 동시 단언.
- toHaveBeenCalledWith on value-out (`cors.spec.ts:265`) — skill row 4.
- 구현어휘 이름 (`options.spec.ts:711, 803, 813, 832`): `V_regex`/`V0c`/`V1·V2·V3`.
- 디버그 흔적 코멘트 (`cors.spec.ts:118-121`).
- `asserts` 헬퍼 무력화 (`cors.spec.ts:44-54` 후 60+회 `as` 캐스팅).
- non-null 단언 60+회 (`options.spec.ts:result!.data.reason`).
- 죽은 테스트: `cors.spec.ts:223-234` (no-flag idempotency 약한 control), `:544-555`, `options.spec.ts:77-85, 844-855`.

## 9. 생존 mutation (구조적 한계)

- `CorsAction` 문자열 값 변경 (`enums.ts:5-11`).
- `CorsRejectionReason` 문자열 값 변경 (`enums.ts:17-25`).
- `CORS_DEFAULT_METHODS` 리터럴 변경 (`constants.ts:3-10`).
- `CorsError.name = 'CorsError'` 제거 (`interfaces.ts:52-55`).
- `HttpStatus` enum과 `optionsSuccessStatus` 범위 불일치 (`middleware.ts:43`).

## 10. 결론 (v3)

- 유효 계약 케이스: **115건**
- 테스트 갭: **46건** (커버리지 60.0%)
- 구현 갭 (SPEC_DRIFT): **3건**
- NON_FEATURE: **4건**
- MULTI_PKG: **1건**
- 생존 mutation: **5건**

가장 큰 단일 블록:
1. PNA 유닛 spec 0건 (C-PN-1~6).
2. Middleware 콜로케이션 spec 부재 (C-MW-1~8).
3. R6454 origin 직렬화 미적용 (C-OR-5, C-OR-6).

"src 모든 파일 라인단위 정독 후 30+ 결함"(구현→테스트 역방향) 작업은 계약 기반 115케이스 도출의 약 60% 수준만 다뤘다. 일부 mutation은 spec 작성 방식 자체의 구조적 한계로 잡히지 않는다.
