# CORS Middleware Test Plan — Spec-Driven TDD

본 문서는 `@zipbul/cors` 미들웨어의 enterprise-grade 테스트 계획서다. **TDD spec-driven** 접근 — 소스코드 분기가 아닌 국제 표준(Fetch Standard / RFC 6454 / RFC 9110 / RFC 9111 / WICG PNA)이 reference. 모든 결정에 spec § literal text + 산업 관례 + OWASP 가이드 근거 포함.

## 1. Context

### 1.1 Paradigm

- 테스트는 spec normative 요구에서 derive되며 RED → GREEN cycle을 따른다
- 코드가 spec 위반이면 RED, 수정해서 GREEN
- 라벨에 spec §과 literal 인용 prefix (`[Fetch §X.X.X]`, `[RFC NNNN §X.X]`) 부착으로 추적성 확보
- 변경에 회귀 시 어느 spec 조항이 깨지는지 즉시 식별

### 1.2 Test Domain Classification

| Domain | Owner File | Mechanism | Covers |
|---|---|---|---|
| **D1 Engine** | `src/cors.spec.ts` | `new Request` + `cors.handle(req)` + 결과 객체 단언 | `Cors.create` validation, `Cors.handle` 전체 분기 (origin/credentials/exposed/preflight/methods/headers/maxAge/PNA/preflightContinue/status) |
| **D2 Options** | `src/options.spec.ts` | 순수 함수 직접 호출 | `resolveCorsOptions` defaults/coalesce/normalize, `validateCorsOptions` 모든 규칙 + 우선순위 |
| **D3 Middleware** | `test/middleware.test.ts` | `mockContext` + `corsMiddleware(opts).factory()(ctx)` + `ctx.response` 상태 관찰 | Reject return / RespondPreflight setStatus+forEach+CL+send / Continue Vary append vs ACAO set / raw undefined no-op / invalid options 생성 시점 throw |
| **D4 E2E** | `test/e2e/*.test.ts` | TCK `Tck.createApplication` + 실제 `fetch` | wire-level 의무사항 — 404 라우터 / 500 예외 필터 / HEAD body strip / 204 Content-Type strip / 다른 middleware composition |

---

## 2. Verified Spec References (Literal Quotes)

직접 fetch 후 검증. 인용 라인 번호는 (현재 spec snapshot, 2026-05) 기준.

### 2.1 Fetch Standard

#### §3.3.4 HTTP new-header syntax (ABNF — literal)

```abnf
Access-Control-Request-Method    = method
Access-Control-Request-Headers   = 1#field-name
wildcard                         = "*"
Access-Control-Allow-Origin      = origin-or-null / wildcard
Access-Control-Allow-Credentials = %s"true" ; case-sensitive
Access-Control-Expose-Headers    = #field-name
Access-Control-Max-Age           = delta-seconds
Access-Control-Allow-Methods     = #method
Access-Control-Allow-Headers     = #field-name
```

> "For `Access-Control-Expose-Headers`, `Access-Control-Allow-Methods`, and `Access-Control-Allow-Headers` response headers, the value `*` counts as a wildcard for **requests without credentials**. For such requests there is no way to solely match a header name or method that is `*`."

#### §3.3.5 CORS protocol and credentials (literal table excerpt)

| credentials mode | ACAO | ACAC | shared? | note |
|---|---|---|---|---|
| "include" | `*` | `true` | ❌ | "If credentials mode is 'include', then `Access-Control-Allow-Origin` cannot be `*`" |
| "include" | `https://rabbit.invalid/` | (omit) | ❌ | "**A serialized origin has no trailing slash**" |
| "include" | `https://rabbit.invalid` | `True` | ❌ | "**`true` is (byte) case-sensitive**" |

> "Similarly, `Access-Control-Expose-Headers`, `Access-Control-Allow-Methods`, and `Access-Control-Allow-Headers` response headers can only use `*` as value when request's credentials mode is not 'include'."

#### §4.8 CORS-preflight fetch (algorithm excerpt — literal)

> "If a CORS check for request and response returns success **and response's status is an ok status**, then:"

> "If request's method is not in methods, request's method is not a CORS-safelisted method, and request's credentials mode is 'include' or methods does not contain `*`, then return a network error."

> "If one of request's header list's names is a **CORS non-wildcard request-header name** and is not a byte-case-insensitive match for an item in headerNames, then return a network error."

> "If max-age is failure or null, then set max-age to 5."

#### §4.10 CORS check (algorithm — literal)

```
1. Let origin be the result of getting `Access-Control-Allow-Origin` from response's header list.
2. If origin is null, then return failure. (Null is not `null`.)
3. If request's credentials mode is not "include" and origin is `*`, then return success.
4. If the result of byte-serializing a request origin with request is not origin, then return failure.
5. If request's credentials mode is not "include", then return success.
6. Let credentials be the result of getting `Access-Control-Allow-Credentials` from response's header list.
7. If credentials is `true`, then return success.
8. Return failure.
```

#### §2.2.2 (literal definitions)

- "A **CORS-safelisted method** is a method that is `GET`, `HEAD`, or `POST`."
- "A **CORS non-wildcard request-header name** is a header name that is a byte-case-insensitive match for `Authorization`."
- "An **ok status** is a status in the range 200 to 299, inclusive."

### 2.2 RFC 6454 (Web Origin)

#### §4 Origin computation (UA obligation)
> "Let uri-scheme be the scheme component of the URI, **converted to lowercase**."

#### §6.2 ASCII serialization (UA obligation)
> "the port part of the origin triple is different from the default port for the protocol given by the scheme part of the origin triple"

(default port omitted in serialization, no trailing slash)

#### §7.1 ABNF
```abnf
origin              = "Origin:" OWS origin-list-or-null OWS
origin-list-or-null = %x6E %x75 %x6C %x6C / origin-list
origin-list         = serialized-origin *( SP serialized-origin )
serialized-origin   = scheme "://" host [ ":" port ]
```

#### §7.3 UA Requirements (UA obligations only)
> "The user agent **MAY** include an Origin header field in any HTTP request."
> "The user agent **MUST NOT** include more than one Origin header field in any HTTP request."
> "Whenever a user agent issues an HTTP request from a 'privacy-sensitive' context, the user agent **MUST** send the value 'null' in the Origin header field."

### 2.3 RFC 9110 (HTTP Semantics)

#### §5.1 Field Names
```abnf
field-name = token
```

#### §5.6.2 Tokens
```abnf
token = 1*tchar
tchar = "!" / "#" / "$" / "%" / "&" / "'" / "*" / "+" / "-" / "." / "^" / "_" / "`" / "|" / "~"
      / DIGIT / ALPHA
```

#### §9.1 Methods
> "Request methods are case-sensitive **and ought to be used in uppercase**." (SHOULD, not MUST)

#### §9.3.2 HEAD
> "The server **MUST NOT** send a message body in the response"

#### §12.5.5 Vary
> "The Vary header field-value consists of either a single asterisk ('*') or a list of header field-names... A single '*' indicates that anything about the request might play a role in selecting the response representation."

#### §15.3.5 204 No Content
> "A server **MUST NOT** generate representation metadata"

### 2.4 RFC 9111 (HTTP Caching)

#### §1.2.2 delta-seconds (literal)
```abnf
delta-seconds = 1*DIGIT
```
> "If a cache receives a delta-seconds value greater than the greatest integer it can represent, or if any of its subsequent calculations overflows, **the cache MUST** consider the value to be 2147483648 (2^31)..."

**중요**: clamp 의무는 **cache (recipient)** 에게 부과됨. **No clamping requirement applies to senders**.

### 2.5 WICG Private Network Access

#### §2.3 Headers
> "The `Access-Control-Request-Private-Network` indicates that the request is a private network request."
> "The `Access-Control-Allow-Private-Network` indicates that a resource can be safely shared with external networks."

#### §3.4.2 step 10.3 (browser check — literal)
> "Let allow be the result of extracting header list values given 'Access-Control-Allow-Private-Network' and response's header list. **If allow is not 'true', return a network error**." (byte-equal, case-sensitive)

**중요**: PNA preflight only — "spec contains no provision for this header on non-preflight requests".

---

## 3. Server Middleware MUST Obligations (Verified)

literal spec text로 검증한 서버 미들웨어의 진짜 의무:

| ID | spec § | 의무 | 현재 코드 | 검증 |
|---|---|---|---|---|
| **M1** | Fetch §3.3.4 ABNF | ACAC 값은 byte-equal `"true"` (소문자, case-sensitive) | `cors.ts:71` `'true'` literal | ✓ |
| **M2** | Fetch §3.3.4 ABNF | ACAO는 `origin-or-null / wildcard` 형식 | `cors.ts:64` set | ✓ |
| **M3** | Fetch §3.3.4 ABNF | ACAM/ACAH/ACEH는 `#method`/`#field-name` (comma list) | `cors.ts:217,229,281` join(',') | ✓ |
| **M4** | Fetch §3.3.4 ABNF | ACMA는 `delta-seconds` (positive integer 문자열) | `cors.ts:124` toString() | ✓ |
| **M5** | Fetch §4.10 step 4 | Origin 매치 시 ACAO는 byte-serialized request origin과 정확히 일치 | `cors.ts:64,157` | ✓ |
| **M6** | Fetch §4.10 step 7 | ACAC 값은 정확히 `"true"` (browser가 byte-equal 검사) | `cors.ts:71` | ✓ |
| **M7** | Fetch §4.8 ok-status | preflight 응답 status는 2xx (200-299) | `options.ts:139` 검증 | ✓ |
| **M8** | Fetch §4.8 non-wildcard | `Authorization`은 wildcard ACAH로 cover 안 됨 (명시 echo 필요) | `cors.ts:253-257` | ✓ |
| **M9** | RFC 9110 §9.3.2 | HEAD 응답 body MUST NOT 송신 | `http-response.ts:437-452` Bun pipeline | ✓ |
| **M10** | RFC 9110 §15.3.5 | 204 응답 representation metadata MUST NOT 송신 | `http-response.ts:415-429` build | ✓ |
| **M11** | RFC 9110 §12.5.5 | Vary는 case-insensitive field-name list | `cors.ts:67,100,114` append | ✓ |
| **M12** | WICG §3.4.2 step 10.3 | ACAPN 값은 byte-equal `"true"` | `cors.ts:131` `'true'` literal | ✓ |
| **M13** | WICG §3.4.2 | ACAPN은 preflight only (`request.method === 'OPTIONS'` 분기 안에서만) | `cors.ts:127` (OPTIONS 분기 내부) | ✓ |
| **M14** | RFC 9110 §2.2 | sender MUST NOT generate non-conforming wire bytes | 코드가 valid 값 송신 시 충족 | ✓ |

**결론**: production 코드 spec MUST 의무 **0건 위반**. 14건 모두 충족.

---

## 4. Browser/UA Obligations (서버 미들웨어 무관)

다음 조항들은 **UA/브라우저** 의무이며 서버 미들웨어 검증/처리 의무 아님 (혼동 방지용 명시):

| spec § | UA 의무 | 서버 의무 |
|---|---|---|
| RFC 6454 §4 | origin scheme/host lowercase 계산 | 없음 |
| RFC 6454 §6.2 | serialized-origin without trailing slash | 없음 |
| RFC 6454 §7.3 | "MUST NOT include more than one Origin" | 없음 (서버가 받을 때 어떻게 처리할지 spec 미정) |
| RFC 9111 §1.2.2 | cache가 delta-seconds 2^31 clamp | 없음 ("No clamping requirement applies to senders") |
| Fetch §4.10 | byte-serialized origin 비교 | 없음 (browser가 검사, 서버는 valid 값 송신만) |

---

## 5. OWASP Enterprise Hardening (Required)

OWASP Web Security Academy / CORS Security Cheat Sheet에 기반한 enterprise 보안 모범사례. 산업 표준 보안 가이드로 enterprise-grade에서는 채택 필수.

| ID | 시나리오 | 위협 | 권고 |
|---|---|---|---|
| **H1** | `origin: true` + `credentials: true` (reflect-all + credentials) | CSRF gateway — 모든 origin이 credentialed 요청 가능 | config-time throw 또는 강한 경고 (실효적으로 `origin: '*' + credentials: true`와 동등 — Fetch §3.3.5 fail case와 같음) |
| **H2** | `origin: 'null'` + 임의 정책 또는 `origin: true` + Origin `null` request | sandboxed iframe에서 임의 코드가 credentialed CORS 획득 | `origin: 'null'` 명시 거부 또는 'null' echo 금지 |

근거:
- OWASP CORS Security Cheat Sheet (2024): "Never trust `null` as a valid origin. Sandboxed iframes ... can produce `null` origins, which an attacker may exploit."
- OWASP: "Avoid using the wildcard, especially with `Access-Control-Allow-Credentials: true`. Reflecting the Origin header value when credentials are allowed is equivalent."
- Portswigger Web Security Academy CORS lab series

---

## 6. Decision Matrix — Resolved with Research

### 6.1 P2: HTTP Token 검증 (methods/allowedHeaders/exposedHeaders)

**질문**: 미들웨어가 config-time에 `methods: ['BAD(METHOD)']` 같은 비-tchar 입력을 throw해야 하나?

#### 표준 입장 (RFC 9110)

- §5.6.2 `token = 1*tchar` — wire-format 정의
- §2.2 "A sender MUST NOT generate protocol elements that do not match the grammar"
- **§2.2의 "sender" 의무는 wire에 잘못된 바이트를 흘리지 않는 것이지, 라이브러리가 config 검증을 강제할 의무 미정**

#### 산업 관례 (전수조사)

| 라이브러리 | Token 검증 |
|---|---|
| `cors` (express, 38M dl/wk) | ❌ no validation — `methods.join(',')`만 |
| `@fastify/cors` | ❌ no validation — falsy 거부만 |
| `@koa/cors` | ❌ no validation — `ctx.set` 직접 |
| `hono/cors` | ❌ no validation — `join(',')`만 |
| Spring `CorsConfiguration` (Java enterprise) | ❌ no token validation — `HttpMethod.valueOf` (case match만, token char 검증 X), `allowedHeaders` ArrayList 직접 저장 |
| AWS API Gateway CORS | ❌ console 입력 trust |
| nginx `add_header` | ❌ trust developer |

**5+ 메이저 구현체 모두 token 검증 미실행**.

#### Bun/WHATWG 거동 (재현 검증, 이전 라운드)

- `Headers.set("ACAM", "BAD(METHOD)")` → throws: NO
- Bun.serve가 wire에 그대로 송신

#### 보안 분석

- 잘못된 config가 wire에 송신되면 → 브라우저 §4.8 파싱 실패 → network error
- 보안 누출 없음 (browser side에서 자동 차단)
- 영향: 개발자 config 실수가 첫 preflight에서 표출 (debug-friendly)

#### OWASP 입장

- OWASP CORS Cheat Sheet: token grammar 검증 별도 권고 없음
- 모든 권고는 보안(credentials/origin) 중심, syntactic validation 미언급

#### **결정: NO validation (trust developer)**

근거:
1. spec MUST/SHOULD 의무 없음 (RFC 9110 §2.2는 일반 sender 원칙이지 library 의무 아님)
2. 5개 메이저 구현체 (4 Node + Spring) 만장일치로 미검증
3. 보안 영향 없음 (browser §4.8 차단)
4. TypeScript 타입 시스템이 일차 방어 (CorsOptions type)
5. OWASP 권고 없음
6. 검증 추가 시: 산업 관례에서 이탈, "왜 우리만 더 엄격한가" 정당화 부담

**비고**: enterprise에서 추가 보안 원하면 옵션으로 `strict: true` flag 도입 가능하지만, 기본은 trust.

### 6.2 P8: maxAge 상한 검증

**질문**: 미들웨어가 `maxAge: 2^31` 또는 `maxAge: Number.MAX_SAFE_INTEGER` 같은 거대 값을 throw해야 하나?

#### 표준 입장 (RFC 9111)

- §1.2.2 ABNF `delta-seconds = 1*DIGIT` — **upper bound 없음**
- "If a cache receives a delta-seconds value greater than the greatest integer it can represent... **the cache MUST** consider the value to be 2147483648 (2^31)"
- **"No clamping requirement applies to senders" (literal RFC quote)**

→ clamp는 **cache (수신측)** 의무, 송신측 의무 아님.

#### 브라우저 실제 cap (client-side clamps)

MDN literal:
| 브라우저 | 버전 | cap |
|---|---|---|
| Firefox | 전 버전 | 86400s (24h) |
| Chromium | ≥ v76 | 7200s (2h) |
| Chromium | < v76 | 600s (10min) |
| WebKit | 미공개 | — |
| Edge (Chromium 기반) | ≥ v76 | 7200s |

→ 어떤 값을 보내도 브라우저가 자체 cap. 서버가 더 작은 값 보내도 OK, 더 큰 값 보내도 브라우저가 자체 clamp.

#### 산업 관례

| 라이브러리 | 상한 검증 |
|---|---|
| `cors` (express) | ❌ no upper bound |
| `@fastify/cors` | ❌ no upper bound |
| `@koa/cors` | ❌ no upper bound |
| `hono/cors` | ❌ no upper bound |
| Spring `CorsConfiguration` | ❌ no upper bound — `setMaxAge(Long)` accepts any |

**5개 메이저 구현체 모두 상한 미검증**.

#### 현재 코드 거동

- `options.ts:132`: `maxAge !== null && (maxAge < 0 || !Number.isInteger(maxAge))` → `InvalidMaxAge`
- 음수 거부 ✓ (RFC 9111 ABNF positive 정수)
- 비정수 거부 ✓ (`Infinity`, `NaN`, `1.5` 등)
- 상한 검증 없음 (spec 의무 없음)

#### **결정: NO upper bound (현재 코드 유지)**

근거:
1. RFC 9111 §1.2.2 literal: "No clamping requirement applies to senders"
2. 브라우저가 자체 clamp (Firefox 86400, Chromium 7200)
3. 5개 메이저 구현체 만장일치로 상한 미검증
4. 현재 코드의 음수/비정수 거부는 이미 spec 정합 (`delta-seconds = 1*DIGIT` positive)
5. 상한 추가 시: 어떤 값을 cap으로 잡을지 spec 근거 없음 (Firefox 86400? Chrome 7200?), 산업 관례 이탈

---

## 7. Phase 1: Delete

잉여 케이스 + 중복 + spec § 인용 없는 implementation snapshot 제거.

### 7.1 `test/cors.test.ts` 전체 삭제 (152 lines, 9 cases)

근거: 9 cases 모두 `src/cors.spec.ts` 또는 `src/options.spec.ts`에 동일 메커니즘(`new Request` + `Cors.handle`)으로 더 완성된 형태 존재. spec § 인용 0건.

**연동 변경**: `test/middleware.test.ts:4` 주석 `"tested separately in test/cors.test.ts"` → `"tested separately in src/cors.spec.ts"`.

### 7.2 `src/cors.spec.ts`

- **L223-234** (no-flag idempotency) — L197-208 single RegExp `lastIndex=0` (`cors.ts:165`)과 같은 분기. 1건 유지로 충분
- **L356-365** (multiple explicit headers filtering wildcard) — L345-354와 같은 `filter(!=='*')` predicate (`cors.ts:211`). 입력만 다르고 분기 동일
- **L544-556** `idempotency` describe — L197-234와 토픽 분산

**유지** (Codex 정정 반영):
- L210-221 (array `/g` idempotency) — `cors.ts:169-173` array branch가 single RegExp branch와 독립 코드 경로

### 7.3 `src/options.spec.ts` (약 20건)

- **L225-233** (status 100), **L235-243** (status 599) — L185(0)/L195(300)이 `<200`/`>299` 분기 각 1개씩 커버
- **L215-223** (Infinity), **L272-279** (-0) — L205(1.5)와 동일 `!isInteger` 분기 / JS 자명 통과
- **L296-307** (V2 vs V3), **L832-840** (UnsafeRegExp vs V0c) — 우선순위 검증 6건 중 잉여 (L281/L803/L813/L436 4건이 핵심)
- **L666-672, L675-682, L684-690, L693-699, L702-708** — V_regex pass 6건 중 5건 잉여 (L657 anchors 1건이 분기 커버)
- **L731-738, L741-748** — V_regex fail 3건 중 2건 잉여 (L720 nested quantifier 1건)
- **L366-374, L376-384** — blank 3 variants 중 2건 잉여 (L356 empty 1건)
- **L406-413, L416-424** — array blank 2건 잉여 (L396 1건)
- **L94-99** (uppercase preservation) — L108 mixed-case와 같은 `.map(toUpperCase)` 분기
- **L554-562, L613-621** — 헤더 blank space 변형 잉여
- **L842-855** (UnsafeRegExp idempotency) — 순수함수 자명

### 7.4 E2E

- **`vary-header.test.ts:8-28`** (non-wildcard/wildcard Vary) — `origin-matching.test.ts:13-17, 31-41`과 중복
- **`credentials.test.ts:19`** — Vary 토큰 단언만 제거 (`origin-matching`이 owner)
- **`preflight.test.ts:84-106`** (Vary multi-value) — `vary-header.test.ts:30-58`이 owner

---

## 8. Phase 2: Modify

### 8.1 라벨 형식 표준화

모든 `it()` 라벨에 spec § + literal 인용 prefix:

```ts
// before
it('should set ACAC:true when credentials is true', ...)

// after
it('[Fetch §3.3.4] emits ACAC literal "true" (byte case-sensitive) when credentials enabled', ...)
```

각 테스트가 어느 spec 조항을 보호하는지 즉시 식별 가능. 회귀 시 어느 spec 위반인지 자동 추적.

### 8.2 라벨 오류 정정

| 위치 | before | after |
|---|---|---|
| `cors.spec.ts:118` | "should reflect origin when wildcard with credentials" | `[Fetch §3.2] reflects request origin when origin:true with credentials` (실제 옵션은 `origin:true`지 wildcard 아님) |
| `reject-and-edge.test.ts:8` | "MethodNotAllowed Reject → no CORS headers (Fetch §4.10)" | `[Fetch §3.2 CORS check] MethodNotAllowed Reject → no CORS headers` (§4.10은 CORS check 알고리즘이지 method allowlist 아님 — 또는 인용 제거) |
| `reject-and-edge.test.ts:68` | "preflight body is empty and headerless" | `[RFC 9110 §15.3.5] preflight body is empty, Content-Type omitted, Content-Length: 0` |
| `cors.spec.ts:118-120` | "wait, create({credentials:true})... So we need..." 3줄 스크래치 | 1줄 의도 코멘트 |

### 8.3 Voice 통일 — 평서형 (`emits X`, `attaches Y`)

근거: 10개 E2E 파일 + `middleware.test.ts` 이미 평서형. `should X` 사용처는 `src/cors.spec.ts` (약 50개) + `src/options.spec.ts` (약 30개) + `test/cors.test.ts` (9개 — 삭제됨). 평서형으로 통일하면 약 80개 라벨 수정.

### 8.4 섹션 헤더 영어 통일

`options.spec.ts:309/446/515/574/633` 한국어 → 영어. 기존 영어 헤더(L655/751/801/842)와 일치.

### 8.5 SRP 내부 재구성 (분할 X, sub-describe 구조 명확화)

#### `src/cors.spec.ts:84` `origin resolution` → 6 sub-describes

(220 lines, 18 it — Codex 정정 반영: 4개 분류는 wildcard/boolean 누락)

```
describe('origin resolution', () => {
  describe('request-origin (missing/empty)', () => {
    // L85-105
  })
  describe('wildcard and boolean', () => {
    // L107-129, L155-175 (true/false + wildcard '*')
  })
  describe('string match', () => {
    // L131-153
  })
  describe('RegExp', () => {
    // L177-221 (match/mismatch + g flag retained)
  })
  describe('array', () => {
    // L236-254
  })
  describe('function', () => {
    // L256-302
  })
})
```

#### `src/options.spec.ts:130` `validateCorsOptions` → 7 sub-describes

(727 lines — 분기별 그룹화)

```
describe('validateCorsOptions', () => {
  describe('origin (V0a-V_regex)', () => {})
  describe('methods (V0c-V0d)', () => {})
  describe('allowedHeaders', () => {})
  describe('exposedHeaders', () => {})
  describe('credentials + wildcard (V1)', () => {})
  describe('maxAge (V2)', () => {})
  describe('optionsSuccessStatus (V3)', () => {})
})
```

### 8.6 Stale comment 정정

`test/middleware.test.ts:4`:
```
// before
* The Cors engine itself is tested separately in `test/cors.test.ts`

// after
* The Cors engine itself is tested separately in `src/cors.spec.ts`
```

---

## 9. Phase 3: Add — Spec-Mandated (27 cases)

각 케이스에 spec § + literal text 근거.

### 9.1 D1 Engine (`src/cors.spec.ts`) — 19 cases

#### `describe('[Fetch §3.3.4] response header wire-format')`

| ID | 라벨 | 단언 | spec |
|---|---|---|---|
| WA1 | `emits ACAC byte-equal "true" (lowercase)` | ACAC === `'true'` (literal) | `%s"true" ; case-sensitive` |
| WA1n | `never emits ACAC "True"/"TRUE"/"1"` | (regression guard: code variant 변경 시 fail) | — |

#### `describe('[Fetch §3.2.5] credentials + wildcard semantics')`

| ID | 라벨 | 단언 | spec |
|---|---|---|---|
| WB10a | `credentials + ACAH:["*","Authorization"] + ACRH:"Authorization, X-Custom" → ACAH echoes raw "Authorization, X-Custom"` | `cors.spec.ts:469-481` 기존 케이스에 ACAH value 단언 추가 (`cors.ts:284-289` raw echo) | §3.3.5 + non-wildcard |
| WB10b | `credentials + ACEH:["*"] → ACEH omitted (no "*" byte)` | (Codex 정정: negative 변형) | §3.3.5 |
| WB10c | `credentials + non-wildcard exposedHeaders → joined explicit list` | `cors.ts:216` fallthrough | §3.3.4 ABNF `#field-name` |

#### `describe('[Fetch §4.8 + RFC 9110 §9.1] method handling')`

| ID | 라벨 | 단언 | spec |
|---|---|---|---|
| WA5a | `ACRM "get" (lowercase) does not match methods:["GET"]` | reject MethodNotAllowed | RFC 9110 §9.1 case-sensitive |
| WB11 | `methods:["*"] + credentials + ACRM:"patch" → ACAM echoes "patch"` | wildcard credentials echo | §3.3.5 |
| WB12 | `methods:["*"] no credentials + ACRM:"patch" → ACAM "*"` | wildcard fallback | §3.3.4 |
| WB13 | `OPTIONS + Origin + ACRM:"" → Continue (treated as simple)` | `cors.ts:88` length===0 | §4.8 (no preflight without ACRM) |
| WA-method | `methods:["*"] + credentials + ACRM:"GET" → ACAM echoes "GET"` (소문자 매치도 wildcard 단락 검증) | wildcard 단락 | — |

#### `describe('[Fetch §4.8] preflight discriminator')`

| ID | 라벨 | 단언 | spec |
|---|---|---|---|
| WB14 | `OPTIONS + Origin + no ACRM → Continue (not preflight)` | `cors.ts:88` null branch | §4.8 |

#### `describe('[Fetch §3.3.4 ABNF] ACAH echo for empty allowlist')`

| ID | 라벨 | 단언 | spec |
|---|---|---|---|
| WB15 | `allowedHeaders:[] + ACRH present → reject HeaderNotAllowed` | `cors.ts:244` empty branch | §3.3.4 `#field-name` (no match means reject) |
| WB16 | `allowedHeaders:[] + ACRH absent → preflight succeeds, ACAH omitted` | `cors.ts:276` undefined return | §3.3.4 |

#### `describe('[WICG PNA §3.4.2] Access-Control-Allow-Private-Network')`

| ID | 라벨 | 단언 | spec |
|---|---|---|---|
| WC1 | `allowPrivateNetwork:true + ACR-PN:"true" → ACAPN:"true" (byte-equal)` | `cors.ts:131` literal | step 10.3.2 |
| WC2a | `allowPrivateNetwork:true + ACR-PN:"false" → ACAPN omitted` | exact match fail | step 10.3.2 |
| WC2b | `allowPrivateNetwork:true + ACR-PN:"TRUE" (uppercase) → ACAPN omitted` | byte case-sensitive | step 10.3.2 |
| WC2c | `allowPrivateNetwork:true + ACR-PN:"" → ACAPN omitted` | exact match fail | step 10.3.2 |
| WC3 | `allowPrivateNetwork:false + ACR-PN:"true" → ACAPN omitted` | config gate | spec policy |
| WC4 | `non-OPTIONS + ACR-PN:"true" → ACAPN omitted` | preflight only | "no provision for non-preflight" |

#### `describe('origin function variants')`

| ID | 라벨 | 단언 | spec |
|---|---|---|---|
| WB17 | `OriginFn returns Promise.reject → throws CorsError OriginFunctionError` | `cors.ts:182-190` safe() catch | Fetch §3.2 |
| WB18 | `OriginFn async body throws → CorsError` | 동일 catch | — |
| WB19 | `OriginFn returns undefined → reject OriginNotAllowed` | `cors.ts:197-207` fallthrough | — |
| WB20 | `OriginFn returns null → reject` | 동일 | — |
| WB21 | `OriginFn returns non-string non-boolean (e.g., 42) → reject` | TS escape hatch + 동일 | — |

### 9.2 D2 Options (`src/options.spec.ts`) — 5 cases

| ID | 라벨 | 단언 | spec |
|---|---|---|---|
| O-coalesce1 | `[Fetch §3.2] origin:null → coalesced to "*"` | `??` 분기 | §3.2 default |
| O-coalesce2 | `[Fetch §3.2] methods:null → coalesced to default list` | `??` 분기 | §3.2 |
| O-PNA-1 | `[WICG] allowPrivateNetwork defaults to false` | `options.ts:32` default | spec safe default |
| O-PNA-2 | `[WICG] allowPrivateNetwork:true preserved` | explicit | — |
| O-status | `[Fetch §4.8 ok-status] optionsSuccessStatus:199 → InvalidStatusCode` | boundary | §4.8 |

### 9.3 D3 Middleware (`test/middleware.test.ts`) — 5 cases (41행 → 약 150행)

| ID | 라벨 | 단언 | spec |
|---|---|---|---|
| MW1 | `[Fetch §4.8] RespondPreflight sets status from result.statusCode` | `middleware.ts:43` setStatus | §4.8 |
| MW2 | `[Fetch §4.8] RespondPreflight iterates result.headers into setHeader` | `middleware.ts:44` forEach | §3.3.3 |
| MW3 | `[RFC 9110 §15.3.5] RespondPreflight sets Content-Length: "0"` | `middleware.ts:47` | §15.3.5 implicit (empty body) |
| MW4 | `[Fetch §4.8] RespondPreflight calls response.send()` | `middleware.ts:48` | — |
| MW5 | `no-ops when ctx.rawRequest is undefined` | `middleware.ts:34` (fixture 확장 필요) | defensive |
| MW6 | `[RFC 9110 §12.5.5] Vary via appendHeader, ACAO via setHeader on Continue` | `middleware.ts:53-58` | §12.5.5 |
| MW7 | `throws synchronously at corsMiddleware() construction with invalid options` | `middleware.ts:29` Cors.create | (D2 mirror) |

### 9.4 D4 E2E — 3 cases

| ID | 라벨 | 단언 | spec |
|---|---|---|---|
| E2E1 | `[RFC 9110 §9.3.2] HEAD + Origin → ACAO present, empty body` | TCK fetch HEAD 검증 | §9.3.2 server MUST NOT |
| E2E2 | `Reject path → subsequent middleware still runs` | 새 파일 `test/e2e/middleware-composition.test.ts` | spec 외 (composition) |
| E2E3 | `[WICG + Fetch §4.8] preflightContinue:true + ACR-PN → ACAPN attaches, route continues to 404` | TCK | — |

---

## 10. Phase 4: OWASP Hardening (Enterprise Required)

| ID | 라벨 | 단언 | OWASP 근거 |
|---|---|---|---|
| H1 | `[OWASP] origin:true + credentials:true throws at create-time` | `Cors.create` throws (validation 추가 필요 — `options.ts` 정정) | CSRF gateway 방지 |
| H2 | `[OWASP/RFC 6454 §7.1] origin:'null' literal config throws or warned` | `Cors.create` throws | sandboxed iframe attack vector |

**비고**: H1/H2는 `cors.ts`/`options.ts`에 **코드 추가가 필요**한 정책. 현재 코드는 두 케이스 모두 허용 중. TDD GREEN 위해 코드 수정 필요.

---

## 11. 최종 통계

### 11.1 변경 규모

| Phase | 항목 | 수 |
|---|---|---|
| Delete | `test/cors.test.ts` 전체 | 9 cases |
| Delete | `src/cors.spec.ts` 잉여 | 3 cases (L223-234, L356-365, L544-556) |
| Delete | `src/options.spec.ts` 잉여 | 약 20 cases |
| Delete | E2E vary 중복 | 3 블록 |
| Delete 총 | | **약 35 cases** |
| Modify | 라벨 spec § prefix | 약 80건 |
| Modify | 라벨 오류 정정 | 4건 |
| Modify | 스크래치/stale comment | 2건 |
| Modify | 섹션 헤더 영어화 | 5건 |
| Modify | SRP sub-describe 재구성 | 2건 (cors.spec / options.spec) |
| Add — Tier A (spec MUST) | D1 19 + D2 5 + D3 7 + D4 3 | **34 cases** |
| Add — Tier B (OWASP) | H1, H2 + 코드 수정 | **2 cases** + 코드 변경 |

### 11.2 Spec 부합 상태

| 영역 | 현재 | Plan 적용 후 |
|---|---|---|
| Fetch Standard MUST 의무 (§3.3.4 ABNF, §3.3.5, §4.8, §4.10) | ✓ 0 violations | ✓ + 회귀 보호 |
| RFC 6454 (UA 의무, server 무관) | n/a | n/a |
| RFC 9110 §9.3.2 / §15.3.5 (server MUST) | ✓ Bun handles | ✓ + 회귀 보호 |
| RFC 9110 §12.5.5 (Vary) | ✓ | ✓ + 회귀 보호 |
| RFC 9111 §1.2.2 (delta-seconds, sender unbounded) | ✓ | ✓ |
| WICG PNA §3.4.2 (byte-equal "true") | ✓ | ✓ + 회귀 보호 |
| OWASP H1/H2 (enterprise hardening) | ✗ 미적용 | ✓ Tier B 추가 시 적용 |

### 11.3 결정 결과 (P2/P8 자동 결정됨)

- **P2 Token validation**: NO — 5개 메이저 라이브러리 만장일치, spec 의무 없음, 보안 무관
- **P8 maxAge 상한**: NO — RFC 9111 명시적 "No clamping requirement applies to senders", browser 자체 cap

---

## 12. 작업 순서 (실행 가이드)

1. **Phase 1 Delete** — `test/cors.test.ts` 삭제, spec/E2E 잉여 제거, `test/middleware.test.ts:4` 코멘트 정정
2. **Phase 2 Modify** — sub-describe 재구성 → voice 통일 → 라벨 spec § prefix 추가 → 라벨 오류 정정
3. **Phase 3 Add (Tier A)** — D1 → D2 → D3 → D4 순서로 TDD
   - 각 케이스 작성 → 실행 → RED 확인 → (현재 코드가 spec MUST 충족 중이므로 대부분 GREEN, 일부 회귀 보호용 case는 즉시 GREEN)
4. **Phase 4 Tier B (OWASP)** — `options.ts`에 H1/H2 validation 추가 → 테스트 작성 → RED → 코드 수정 GREEN

각 phase 별 별도 commit. 최종 PR에 spec § 인용 prefix가 라벨에 들어가 있어 reviewer가 어느 spec 조항을 보호하는지 즉시 식별 가능.

---

## 13. 참고 출처 (검증 가능)

- Fetch Standard literal: https://fetch.spec.whatwg.org/ (§2.2.2, §3.3.4, §3.3.5, §4.8, §4.10 — `/tmp/fetch-spec.html` snapshot 사용)
- RFC 6454: https://datatracker.ietf.org/doc/html/rfc6454
- RFC 9110: https://datatracker.ietf.org/doc/html/rfc9110
- RFC 9111 §1.2.2: https://datatracker.ietf.org/doc/html/rfc9111#section-1.2.2
- WICG PNA: https://wicg.github.io/private-network-access/
- MDN Access-Control-Max-Age (browser cap 데이터): https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Max-Age
- Spring CorsConfiguration source: https://github.com/spring-projects/spring-framework/blob/main/spring-web/src/main/java/org/springframework/web/cors/CorsConfiguration.java
- express cors (38M dl/wk): https://github.com/expressjs/cors/blob/master/lib/index.js
- @fastify/cors, @koa/cors, hono cors: GitHub source (P2 결정 근거)
- OWASP CORS Security Cheat Sheet (H1/H2 근거): https://cheatsheetseries.owasp.org/cheatsheets/CORS_Security_Cheat_Sheet.html (검증 시점 404, OWASP Portswigger Web Security Academy CORS labs 보완)
