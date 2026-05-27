# CORS 미들웨어 결함 인수인계 문서

작성 시점: 2026-05-20
검증 차수: 1~11차 (3자 cross-verify: 나 / 서브에이전트 / 코덱스 + 사양 7종 + 코드 분기 60+ 전수 + 메이저 라이브러리 5종 비교 + 실행 재현)
패키지: `packages/middlewares/cors`

## 완전성 보장 불가 명시

본 문서는 "완전성 증명" 을 주장하지 않는다. 11차까지 cross-verify 후에도 추가 결함 발견 가능성을 0 으로 단정 못 한다. 1~10차에서 발견된 결함은 모두 사양 quote + 코드 라인 + bun 재현 3요소를 갖추었고, 라이브러리 5종 비교까지 거쳤으므로 신뢰도는 높으나 "이게 전부" 라는 보장은 없다.

## 범위 재정의 (11차 후 정정)

**기능 범위 안** = zipbul CORS 미들웨어가 사양에 맞게 CORS 응답 헤더를 emit 하고, 사용자가 의도한 정책이 wire 에 정확히 반영되는가. 이 영역의 결함만 §2 / §3 에 배치.

**기능 범위 밖** = defensive programming (`Object.freeze`, enum mutation 방어), JS API surface (JSON.stringify / structuredClone), TypeScript `private` 런타임 강제, 캡슐화 정책. §4 에 분리 배치 (참고용).

---

## 0. 검증 범위와 한계

이 문서가 다루는 범위는 `Cors.create(opts)` / `Cors.handle(request)` / `corsMiddleware(opts)` 가 출력하는 CORS 응답 헤더(`Access-Control-Allow-Origin` / `-Credentials` / `-Methods` / `-Headers` / `-Expose-Headers` / `-Max-Age` / `-Allow-Private-Network` / `Vary`) 와 `Reject` reason 의 의미 정합성이다. 라우터의 404 변환, 프레임워크 error handler 의 500 변환, 어댑터의 request parsing 은 다른 패키지 책임이므로 결함 분류에서 제외했으나, e2e 테스트가 그 통합 결과를 wire-level 어설션으로 검증하는 것은 정당하다.

사양은 Fetch Standard (https://fetch.spec.whatwg.org/), WICG Private Network Access, RFC 6454 (Origin), RFC 9110 (HTTP Semantics), RFC 9111 (HTTP Caching), RFC 9113 (HTTP/2), RFC 9114 (HTTP/3) 를 curl 로 직접 fetch 후 grep verbatim quote 로 인용했다 (`/tmp/cors-review/` 에 보존). WebFetch 의 truncation 때문에 사양 원문은 raw 파일에서 검증했다.

비교 대상 라이브러리는 `cors@2.8.6` (expressjs), `@fastify/cors@11.2.0`, `hono@4.12.18`, `koa-cors` 최신 master, `nestjs` (자체 CORS 코드 없음, 어댑터별로 위 라이브러리 상속) 5종이다.

verify 안 한 영역: RFC 7540 의 deprecated 사용 사례, 실제 Cloudflare/CloudFront 의 휴리스틱 캐시 동작 실측, WebSocket Subprotocol Origin 검증 (RFC 6455 영역으로 CORS 사양 외), HTTP/3 wire-level 의 어댑터 emit 동작.

---

## 1. 분류 매트릭스 (전체 ID 카탈로그)

이 문서가 발견·검증한 모든 결함의 ID 와 분류. 본문 상세는 ID 순서가 아닌 발견 순서 (D 시리즈 → D-NEW 시리즈 → DN 시리즈 → Q 시리즈) 로 배치되어 있다.

### 기능 범위 안 — 사양 MUST / ABNF 위반 (12건)
CORS 미들웨어가 emit 하는 wire 가 Fetch Standard / RFC 9110 / RFC 9111 / RFC 6454 의 사양 의무를 위반하거나, 사용자가 의도한 정책이 wire 에 정확히 반영되지 않는 결함이다.

`D1`, `D2`, `D3`, `D5`, `D6`, `D7`, `G5`, `DN-3`, `DN-31` (D-NEW-1 13차 closed, D-NEW-3 14차 사용자 책임 영역으로 제외)

> 정확한 기준: 산업 평균 비교가 아닌 사양 verbatim 부합. 산업 5/5 라이브러리가 같이 위반하는 결함도 사양 MUST 위반이면 본 카테고리 포함. **DN-31 은 11차에서 강화 후보로 분류했으나 RFC 9110 §5.6.2 token ABNF 위반 카테고리 (D3 와 동일) 로 재분류** (사용자 정확한 기준 지시 반영).

### 기능 범위 안 — Contract / 진단성 약함 (0건, 12차에서 closed)
wire 사양 위반은 없으나 JSDoc 계약, 에러 분류, 의도 일관성 등이 깨지는 경계 결함.

(D-NEW-2 는 12차에서 baker 3.1.0 `isOrigin` 마이그레이션으로 closed. wildcard 분기 2-branch 보존 + 빈 문자열 throw BREAKING.)

### 범위 밖 참고 — Defensive / JS API Surface / TS-level (9건)
**zipbul CORS 미들웨어 기능 범위 밖**. defensive programming (`Object.freeze`), Error API 디테일 (`JSON.stringify`, `structuredClone`), TypeScript `private` 런타임 강제, JS 객체 캡슐화 영역. 발견 사실은 본문에 보존하되 미들웨어 기능 결함으로 분류하지 않는다.

`D-NEW-10`, `D-NEW-11`, `D-NEW-12`, `D-NEW-13`, `D-NEW-14`, `D-NEW-15`, `D-NEW-16`, `D-NEW-17`, `D-NEW-18`

### 강화 후보 — 사양 의무 아님 (4건)
사양이 요구하지 않으나 보안/캐시 효율/일관성 측면 강화 후보.

`DN-1`/`DN-2` (forbidden method advertise — Fetch §2.2.1 "user agent remains in full control" UA-side), `DN-30` (wildcard ACAH credentials 캐시 효율), `DN-32` (OriginFn deadlock — 가용성)

> DN-31 은 §2 사양 위반으로 재분류됨.

### 테스트 품질 (7건)
`Q1` (V_regex 죽은 테스트), `Q2` (약한 어설션), `Q3` (arrayContaining loose), `Q4` (`Origin:'null'` unit 미커버), `Q5` (일관성), `U6` (preflight Vary 회귀 e2e 부재), `§4.10 인용 부정확`

---

## 2. 결함 상세 (발견 순서)

본 섹션은 위 분류 매트릭스의 모든 결함을 발견 순서로 상세 기술한다. 각 결함 헤더는 분류 태그를 포함하지 않으므로 위 매트릭스에서 분류를 확인할 것.

---

### D1. 모든 메서드를 강제 대문자화 → 커스텀 case-sensitive 메서드를 거부함 ✅ CLOSED (2026-05-20)

**해결 경로**: Bun 런타임 사실 검증을 통해 D1 의 트리거 시나리오가 unreachable 임을 확인하고, `methods` 옵션을 closed enum 으로 강제하는 방식으로 결함 자체를 코드 레벨에서 제거.

**확정된 사실 (재현)**:
- Bun runtime parser (`src/http_types/Method.zig` + `packages/bun-uws/src/HttpContext.h`) 는 정확히 **36개** 메서드만 허용. 비-허용 메서드는 EMPTY response 로 거부 (issue #6556 / #21566).
- 36 개 모두 **UPPERCASE byte-exact only**. `Get`, `get`, `gET`, `propfind`, `m-search` 모두 거부 (재현 4 카테고리).
- Bun `@types/bun` 의 `HTTPMethod` 는 7개만 — 부정확.

**적용된 변경**:
1. `packages/adapters/http/src/enums/http-method.ts`: `HttpMethod` enum 을 7 → 36 개로 확장 (Bun 지원 전수 + IANA WebDAV/CalDAV/UPnP 등). 모든 값은 byte-exact UPPERCASE.
2. `packages/adapters/http/src/constants.ts`: `FORBIDDEN_HTTP_METHODS` 를 `[HttpMethod.Trace, HttpMethod.Connect] as const` 로 enum 참조.
3. `packages/adapters/http/src/types/server.ts`: `HttpMethodToken = HttpMethod | (string & {})` 삭제 (Bun custom method 미지원이므로 escape hatch 무의미).
4. `packages/middlewares/cors/src/interfaces.ts`: `methods?: Array<HttpMethod | '*'>` — closed union (HttpMethod enum + 와일드카드 sentinel).
5. `packages/middlewares/cors/src/types.ts`: `ResolvedCorsOptions.methods: ReadonlyArray<HttpMethod | '*'>` — D-NEW-3 의 defensive copy 의도와 일치.
6. `packages/middlewares/cors/src/options.ts:24`: `.map(m => m.toUpperCase())` 제거 + `[...spread]` defensive copy.
7. `packages/middlewares/cors/src/cors.ts`: helper 시그니처 `ReadonlyArray<string>` (wire 값 string 호환 유지, sub-agent 권고).
8. shared 의존 완전 제거: `@zipbul/cors` 가 `@zipbul/http-adapter` 만 사용.

**결과**: `methods: ['Egg']` 같은 비-표준 case 입력 자체가 TypeScript 컴파일 에러로 막힘. 사용자는 `HttpMethod.Propfind` 등 enum 값만 입력 가능. 36개 모두 정확히 wire 에 byte-exact 로 emit 됨. 246/246 unit+e2e pass, build clean.

**부수 해결**:
- D-NEW-3 의 `methods` 옵션 reference 보존 결함 — `[...spread]` 로 해결.
- DN-1/DN-2 의 forbidden method (TRACE/CONNECT) advertise 검증 — `FORBIDDEN_HTTP_METHODS` enum 참조로 type-level guard 강화.

---

### D2. Preflight 응답이 상위 미들웨어의 `Vary` 토큰을 덮어씀 ✅ CLOSED (2026-05-21)

**해결 경로**: 사양 verbatim 확인 결과 wire MUST 위반은 아니지만 (RFC 9110 §9.3.7 OPTIONS non-cacheable + Fetch §4.9 preflight cache Vary 무시), 산업 관례 10/13 (TS/Go/Rust 3 ecosystem 수렴 — tower-http 는 "vary header can have multiple values, don't overwrite" 명시 코멘트) 가 merge 패턴. zipbul 이 hono + elysia + gin 의 deviating 진영에 있을 합당한 이유 없음.

**적용된 변경**: `packages/middlewares/cors/src/middleware.ts:45-62` — `RespondPreflight` 분기와 `Continue` 분기를 공통 `writeHeader` 클로저로 통합. `Vary` 만 `appendHeader` 누적, 나머지는 `setHeader` 교체.

**테스트 (U6 동시 해결)**: `test/e2e/pipeline.test.ts` 에 preflight 경로 prior Vary 보존 시나리오 추가 — RED 확인 후 GREEN 통과.

---

### D3. 옵션 `methods` / `allowedHeaders` / `exposedHeaders` 의 invalid token 이 wire 로 그대로 emit ✅ CLOSED (2026-05-26)

**해결 경로**: Fetch §3.3.4 (`#field-name`) + RFC 9110 §5.6.2 (`token = 1*tchar`) verbatim 위반. baker 3.0 의 `isHttpToken` predicate 도입으로 정공 해결. `methods` 부분은 D1 (HttpMethod closed enum) 으로 컴파일 타임 차단 — 자동 해결.

**적용된 변경 (allowedHeaders / exposedHeaders)**:
- `options.ts`: 두 분기를 `for...of + isHttpToken(name) !== true` 로 대체. `isHttpToken` 이 빈 문자열/공백 모두 cover → 기존 `isBlank` 호출 제거.
- `origin` 분기 (`:55, :70`) 의 `isBlank` 유지 — URL/regex/wildcard 는 token 규칙 부적합.
- `enums.ts` JSDoc 갱신 (RFC 9110 §5.6.2 1*tchar).

**테스트 (RED→GREEN)**: invalid token 케이스 (`'X-Foo(bar)'`, `'X Foo'`, `'X-Foo,Bar'`) options.spec + cors.spec 5건 추가. 250 pass / 0 fail.

---

### D5. Origin 함수가 동적으로 `'*'` 반환 + credentials:true → `ACAO:*` + `ACAC:true` 동시 emit ✅ CLOSED (2026-05-26)

**해결 경로**: Fetch §3.3.5 row 5 ("If credentials mode is `include`, then `Access-Control-Allow-Origin` cannot be `*`.") wire MUST 위반. boot-time guard (`origin === '*'` + `credentials:true` → throw) 의 runtime mirror 적용.

**적용된 변경**: `src/cors.ts` `resolveOriginResult` 에 분기 추가 — OriginFn 반환값이 `'*'` 이고 `credentials:true` 면 `CorsError(CredentialsWithWildcardOrigin)` throw. 기존 boot-time error reason 재사용.

**테스트 (RED→GREEN)**: `cors.spec.ts` + `middleware.spec.ts` 에 sync/async OriginFn 반환 `'*'`, conditional 분기, factory propagation 4 시나리오. 254 pass / 0 fail.

**남은 별도 결함**: `origin: /.*/` + `credentials:true` (regex 가 모든 origin reflect + ACAC:true, OWASP CSRF anti-pattern); `origin: ['*']` (array dead config). D5 fix 와 다른 trigger 경로 — 별도 결함으로 추적.

---

### D6. Echo mode 에서 invalid ACRH 값이 ACAH 로 그대로 emit ✅ CLOSED (2026-05-26)

**해결 경로**: RFC 9110 §5.6.2 `token = 1*tchar` MUST 위반 — 브라우저 preflight cache 파싱 실패 유발 가능. echo 의도 (valid 토큰 trust) 는 보존하되 invalid 토큰만 silent filter.

**적용된 변경**:
- `src/cors.ts` 에 helper `filterValidHeaderTokens(raw)` 신설 — `parseCommaSeparatedValues` + baker `isHttpToken` 으로 validate, 빈 결과 → `undefined`.
- 두 echo 경로 모두 적용:
  - `allowedHeaders === null` (echo mode, `cors.ts:126-130`)
  - `allowedHeaders: ['*']` + `credentials: true` (wildcard echo, `serializeAllowedHeaders` `cors.ts:294-297`)
- `Vary: Access-Control-Request-Headers` append 를 `ACAH` set 분기 **밖**으로 분리 — 모든 entry filter 되어도 preflight cache key 보존.

**테스트 (RED→GREEN, 3 계층 + e2e)**:
- `cors.spec.ts`: valid mix / all-invalid (ACAH 미발행 + Vary 유지) / wildcard+credentials filter — 4 RED → GREEN
- `allowed-headers.test.ts` e2e: wire-level 동일 시나리오 회귀 방지
- 결과: 260 pass / 0 fail

**boot-time strict 옵션 미도입**: ACRH 는 runtime client 입력. silent filter 가 (a) framework-agnostic 정합 (logger/callback 의존 0), (b) D5 (config 오류 → throw) 와 책임 경계 분리 측면 정공.

**미세 wire 변화**: D6 fix 로 ACAH 값의 OWS 가 제거 (`'X-A, X-B'` → `'X-A,X-B'`). RFC 9110 §5.6.1 list grammar 의 OWS 허용 부분이라 conformant 클라이언트 영향 0. strict string match 하던 클라이언트만 미세 영향 가능.

**explicit `allowedHeaders` 경로는 결함 아님**: client invalid token (예: `'X Bad'`) 이 explicit list 와 lowercase 비교에서 미매치 → `HeaderNotAllowed` reject. server 정책상 정공 동작 (사양 wire MUST 위반 0). reason 의미는 약하지만 별도 결함 아님.

---

### D7. Wildcard methods + credentials + invalid ACRM 이 ACAM 으로 echo ✅ CLOSED (2026-05-26)

**해결 경로**: MDN verbatim — "In requests with credentials, [`*`] is treated as the literal method name `*` without special semantics." 즉 `methods: ['*']` + `credentials: true` 조합 자체가 사양상 무의미한 misconfiguration. 기존 echo 동작은 spec 우회 hack 으로, invalid ACRM 까지 그대로 wire 에 흘려보냈음. D5 패턴 (`origin: '*'` + credentials → boot throw) 과 동일하게 **boot reject** 가 정공.

**적용된 변경**:
- `src/enums.ts`: `CorsErrorReason.CredentialsWithWildcardMethods` 신설
- `src/options.ts`: D5 guard 직후 `credentials === true && methods.includes('*')` boot reject
- `src/cors.ts:248-258`: `serializeAllowedMethods` 의 wildcard+credentials echo 분기 제거 (dead code) — flatten to `return '*'`

**테스트 (RED→GREEN)**:
- `cors.spec.ts`: 기존 echo test → boot throw test
- `options.spec.ts`: credentials:true + ['*'] reject 케이스 추가
- `enums.spec.ts`: 신규 reason 등재
- `test/e2e/methods.test.ts`: 기존 echo e2e → bootCorsApp throw 검증
- 결과: 261 pass / 0 fail

**runtime guard 미도입**: D5 는 OriginFn (동적 입력) 때문에 runtime mirror 필요했지만 `methods` 는 static array 만 — boot guard 로 invariant 완전 보장.

---

### G5. Multi-value Origin (`Origin: a,b`) 이 그대로 ACAO 로 반사

**상황**

`origin: true` (reflect mode) 또는 OriginFn 의 reflect 분기에서 미들웨어는 request 의 `Origin` 헤더 값을 그대로 `Access-Control-Allow-Origin` 으로 emit 한다. 만약 클라이언트(또는 중간 프록시) 가 비표준적으로 `Origin: https://a.com,https://b.com` 같은 comma 포함 값을 보내면 미들웨어는 이를 그대로 wire 에 반사하고 사양 ABNF `Access-Control-Allow-Origin = origin-or-null / wildcard` (단일 값) 를 위반한다.

**사양 근거**

Fetch §3.3.4 ABNF: `Access-Control-Allow-Origin = origin-or-null / wildcard`. 단일 값이며 list 아님.

RFC 6454 §6.1/§6.2 Origin serialization: 단일 scheme://host[:port] 형식.

**코드 위치**

`src/cors.ts:50, 68, 163-165`
```ts
const origin = request.headers.get(HttpHeader.Origin);
// ...
headers.set(HttpHeader.AccessControlAllowOrigin, allowedOrigin);
// ...
if (originOption === true) return origin;   // raw reflect
```

`Headers.get` 이 multi-value 헤더를 콤마로 join 한 단일 string 을 반환하므로 multi-value Origin 이 그대로 흘러간다.

**재현**

```
입력: Cors.create({ origin: true })
     + Request GET, Origin: 'https://a.com,https://b.com'
출력 ACAO: 'https://a.com,https://b.com'
```

**산업 비교**

5/5 동일. Origin 헤더 검증을 어디서도 안 함.

**테스트 갭**

Multi-value Origin 케이스 부재.

**수정 방향**

`cors.ts:50` 직후에 origin 값에 `,` 포함되어 있으면 reject(NoOrigin) 또는 별도 reason 으로 거부. 정상 UA 는 단일 Origin 만 보내므로 호환성 영향 없음. Origin header injection 방어 측면에서도 권장.

---

### D-NEW-1. `maxAge` 가 매우 큰 정수일 때 `toString()` 이 exponential notation 생성 → ABNF 위반

**상황**

`validateCorsOptions:115` 가 `maxAge` 에 대해 `Number.isInteger` 와 `< 0` 만 검사한다. JavaScript `Number.isInteger(1e21)` 는 `true` 를 반환하므로 boot 검증을 통과한다. 그러나 `cors.ts:128` 에서 `this.options.maxAge.toString()` 호출 시 1e21 이상의 정수는 V8/JSC 모두 exponential notation 으로 직렬화한다 (`"1e+21"`). 결과적으로 wire 에 `Access-Control-Max-Age: 1e+21` 같은 RFC 9111 ABNF 위반 값이 흘러간다.

**사양 근거 (RFC 9111 §1.2.2, verbatim from /tmp/cors-review/rfc9111.txt:212-217)**

> ```
> 1.2.2.  Delta Seconds
>    The delta-seconds rule specifies a non-negative integer, representing
>    time in seconds.
>      delta-seconds  = 1*DIGIT
> ```

`1*DIGIT` 는 ASCII 숫자 `0-9` 만 허용. 소수점 `.`, `e`, `+`, `-` 모두 금지.

**코드 위치**

`src/options.ts:115-120`
```ts
if (resolved.maxAge !== null && (resolved.maxAge < 0 || !Number.isInteger(resolved.maxAge))) {
  return err<CorsErrorData>({ reason: CorsErrorReason.InvalidMaxAge, ... });
}
```

`src/cors.ts:127-129`
```ts
if (this.options.maxAge !== null) {
  headers.set(HttpHeader.AccessControlMaxAge, this.options.maxAge.toString());
}
```

**재현 (bun 실행)**

```
maxAge=100000000000000000000 (1e20) → ACMA="100000000000000000000" OK (정수 표기)
maxAge=1e21                          → ACMA="1e+21"                    위반
maxAge=Number.MAX_VALUE              → ACMA="1.7976931348623157e+308"  위반
```

**테스트 갭**

`options.spec.ts:195-247` 가 `-1`, `0`, `1.5`, `Infinity`, `NaN` 만 검증. exponential 임계값(`1e21`) 케이스 부재.

**수정 방향**

`validateCorsOptions` 에서 `maxAge` 상한을 `2147483647` (RFC 9111 §1.2.2 권장 32-bit signed 표현) 또는 `< 1e21` 로 제한. 또는 `cors.ts:128` 에서 `Math.trunc(maxAge).toFixed(0)` 형식으로 직렬화 (BigInt 처리 가능). 더 깔끔한 방향은 boot validation 에서 상한 설정.

**✅ CLOSED (2026-05-27)**: boot validation 에 `resolved.maxAge >= 1e21` 상한 추가 (ECMAScript §6.1.6.1.30 Number::toString 의 exp threshold). 임계값은 `CORS_MAX_AGE_EXPONENTIAL_THRESHOLD` 상수로 분리, JSDoc 에 ECMAScript + RFC 9111 §1.2.2 인용. `Number.isInteger` 분기 유지로 NaN/Infinity/소수 거부 보존. `InvalidMaxAge` enum JSDoc 도 ABNF 위반 메커니즘 명시. wire 정상 영역 (Number.MAX_SAFE_INTEGER, 2^53, 1e20, 9.999e20 등) 은 그대로 통과 — 결함 카테고리 정확히 차단. `.toFixed(0)` 직렬화 대안은 silent normalize 가 되므로 fail-fast 정신과 충돌, 채택 안 함. **No breaking** (1e21+ 영역은 기존에도 wire ABNF 위반을 emit 하던 결함 영역).

---

### D-NEW-2. OriginFn 반환값에 CR/LF 포함 시 raw `TypeError` 누출 (CorsError 미래핑)

**상황**

`cors.ts:185-198` 의 `safe()` wrapper 는 OriginFn 의 **호출 시점 throw** 만 잡는다. 하지만 OriginFn 이 정상적으로 반환한 string 에 CR/LF (`\r\n`) 가 포함되어 있으면, 후속 `headers.set(HttpHeader.AccessControlAllowOrigin, allowedOrigin)` (cors.ts:68) 에서 Web Headers API 가 raw `TypeError` 를 throw 한다. 이 throw 는 `safe()` wrapper 밖이라 잡히지 않고 framework 까지 전파된다. 사용자가 `Cors.handle()` 호출부에서 `catch (e instanceof CorsError)` 패턴을 기대해도 실제로는 `TypeError` 가 도달.

**상황 시나리오**

OriginFn 작성자가 DB lookup, Redis cache, 외부 API 등 untrusted source 에서 origin 문자열을 가져오는 경우. 공격자가 데이터에 CR/LF 를 주입하면 일관된 `CorsError` 처리 흐름이 깨진다. Bun/Node Web Headers API 가 CRLF 를 차단하므로 실제 header injection 자체는 불가능하지만, **에러 분류 contract 위반**이 결함의 본질.

**사양 근거 (Fetch §2.2.2 Headers, RFC 9113 §8.2.1)**

> RFC 9113 §8.2.1 (line 2518-2520, verbatim): "A field value MUST NOT contain the following bytes: 0x00 (NUL), 0x0a (LF), 0x0d (CR)."

코드 `cors.ts:185-198` 의 의도는 "OriginFn 의 어떤 실패도 `CorsError(OriginFunctionError)` 로 래핑" 인데 반환값 sanitize 누락으로 의도와 어긋남.

**코드 위치**

`src/cors.ts:185-198` (호출만 보호, 반환값 미검증)
`src/cors.ts:202-212` (`resolveOriginResult` 가 length 만 검사, CR/LF 검증 부재)
`src/cors.ts:68` (`headers.set` 에서 TypeError throw)

**재현 (bun 실행)**

```
입력: Cors.create({ origin: async () => 'https://a.com\r\nX-Evil: pwn' })
     + Request GET, Origin: 'https://a.com'
출력: throws TypeError: Header 'access-control-allow-origin' has invalid value
     is CorsError? false  ← 기대: true
```

**테스트 갭**

OriginFn 반환값 sanitize 케이스 부재.

**수정 방향**

`resolveOriginResult` (cors.ts:202-212) 에서 반환 string 이 RFC 9110 field-value ABNF 위반(CR/LF/NUL) 인지 검사하고, 위반 시 `undefined` 반환 (silent reject) 또는 `CorsError(OriginFunctionError)` throw. 후자가 일관성 있고 디버깅 친화적.

**✅ CLOSED (2026-05-27)** — baker 3.1.0 `isOrigin` 으로 OriginFn 반환값 런타임 sanitize. 단일 `isOrigin(result) !== true` 검사가 CR/LF/NUL/BOM/zero-width injection, trailing slash, uppercase scheme/host, default port, path/query/fragment, userinfo, raw IDN, parse fail, 빈 문자열, wildcard `'*'`(credentials:false) 까지 모두 일관 reject. wildcard 분기 단독 표면화 + 2-branch 보존: credentials:true + `'*'` → `CredentialsWithWildcardOrigin`(Fetch §3.3.5 wire 결함), 그 외 → `InvalidOriginReturn`(RFC 6454 §6.2 직렬화 결함). 의미축 분리 유지.

**BREAKING (v0.x)**: 기존 `result.length > 0` silent fallthrough 제거. `() => ''` 반환은 silent `OriginNotAllowed` reject 였으나 이제 `CorsError(InvalidOriginReturn)` throw. 거부 신호는 `return false` 로 통일 (types.ts `OriginResult` JSDoc 의 기존 contract).

---

> **정책 — 값 자체 validation 모두 보장 (baker schema 일원화), type 우회는 사용자 책임**: 미들웨어는 `CorsOptions` baker class 의 `@Field` schema 로 모든 옵션 값을 검증한다 — 사양 grammar (RFC 6454 §6.2 / RFC 9110 §5.6.2 / RFC 9111 §1.2.2 / ECMAScript §6.1.6.1.30) + cross-field (credentials + wildcard) + RegExp 의 stateless flag 보장 모두 포함. 옵션 배열은 shallow clone 으로 격리하고 결과는 deep freeze. **단** TypeScript 시그니처를 `as any`/`as unknown`/`as XxxType` cast 로 우회한 입력은 미들웨어가 방어하지 않는다 (`tsc` 의 책임). D-NEW-4~9 가 type 우회를 통해서만 trigger 가능하므로 결함에서 제외했다. D-NEW-3 (사용자 array mutation) 는 14차에서 "사용자 책임 영역" 으로 제외했으나 15차의 schema 일원화 + array clone 으로 미들웨어가 자연 격리하므로 closed 로 재분류했다.

---

### D-NEW-10. `private constructor` 가 런타임 미강제 → invalid options 으로 Cors 인스턴스 생성 가능

**상황**

`cors.ts:18-22`
```ts
export class Cors {
  private constructor(private readonly options: ResolvedCorsOptions) {}
```

TypeScript `private` 은 컴파일 타임만 검사. `new (Cors as any)(rawOpts)` 로 직접 호출하면 `Cors.create` 의 resolve + validate 를 우회. invalid ResolvedCorsOptions 로 인스턴스 생성 가능. 이후 handle 호출 시 내부 raw `TypeError` 발생 (예: `this.options.exposedHeaders.length` of undefined).

**상황 시나리오**

다른 패키지/테스트 hack 에서 우회 가능. `Cors.create` 진입점으로 invariant 강제하는 의도 깨짐.

**재현**:
```
new (Cors as any)({ origin: '*', credentials: true, methods: [], optionsSuccessStatus: 999 })
→ instance 생성 OK
.handle(req) → raw TypeError: undefined is not an object (evaluating 'this.options.exposedHeaders.length')
```

**코드**: `src/cors.ts:18-22`

**수정 방향**: 런타임 강제를 위해 ES2022 `#private` 필드 또는 hidden ctor symbol. 단 사양 의무는 아니라 우선순위 낮음.

---

### D-NEW-11. `throw undefined` 시 `CorsError.cause` 속성 자체가 부재 (정보 보존 계약 위반)

**상황**

`interfaces.ts:55-56`
```ts
constructor(data: CorsErrorData) {
  super(data.message, data.cause !== undefined ? { cause: data.cause } : undefined);
```

`data.cause !== undefined` 가드 때문에, OriginFn 이 `throw undefined` 를 한 경우 ErrorOptions 자체를 전달하지 않아 `e.cause` **속성이 부재**한다 (`'cause' in e === false`, `Object.hasOwn(e, 'cause') === false`).

`interfaces.ts:46-50` 문서는 "the original thrown value is preserved in `cause` for diagnostic purposes" 로 명시. `throw undefined` 라는 진단 정보가 정확히 그 가드 때문에 소실. ECMAScript Error Cause proposal 은 `{cause}` key 존재 자체를 시그널로 사용하므로 의미 있는 차이.

**재현**:
```
throw undefined        → CorsError, 'cause' in e === false (속성 부재)
throw 'real-string'    → CorsError, 'cause' in e === true,  e.cause === 'real-string'
```

다른 throw 패턴 (`throw 'str'`, `throw 42`, `throw null`, `throw object`) 은 모두 cause 정상 보존. `undefined` 만 특이.

**코드**: `src/interfaces.ts:55-56`

**수정 방향**: `data.cause !== undefined` → `'cause' in data` 로 변경. ECMAScript Error Cause 시그널 정합.

---

### D-NEW-12. `cors.options` 가 런타임에 외부 mutable → post-create validation 우회 (사양 MUST 위반 가능)

**상황**

`cors.ts:19-22` 가 `private readonly options: ResolvedCorsOptions` 로 선언. TypeScript `private` + `readonly` 는 컴파일 타임만 검사. ECMAScript private field (`#options`) 미사용. `Object.freeze` 부재. 결과적으로 `Cors.create()` 가 boot-time validation 을 거쳐 인스턴스를 만든 뒤에도, 외부 코드가 `(cors as any).options.credentials = true` 같은 mutation 으로 invariant 를 깨뜨릴 수 있다. D-NEW-10 (private constructor 우회) 과 다른 표면 — D-NEW-10 은 `new (Cors as any)()` 직접 호출이고, D-NEW-12 는 정상 `Cors.create()` 후 instance 의 options 접근.

**재현**

```
1. const cors = Cors.create({ origin: '*' })                       ← validation OK (credentials 미설정)
2. (cors as any).options.credentials = true                        ← post-create mutation, validator 우회
3. cors.handle(Request{ Origin: 'https://evil.com' })
   → wire: ACAO=*, ACAC=true                                       ← Fetch §3.3.5 row5 위반
```

**사양 근거 (Fetch §3.3.5 row5, verbatim)**

> "If credentials mode is `include`, then `Access-Control-Allow-Origin` cannot be `*`."

`validateCorsOptions:108-113` 가 명시적으로 차단해야 한다고 선언한 조합이 외부 mutation 으로 손쉽게 emit 된다. D-NEW-3 (옵션 array reference) 가 array 만 영향이라면, D-NEW-12 는 scalar 옵션까지 모두 영향.

**코드 위치**

`src/cors.ts:19-22`

**수정 방향**

ES2022 `#options` private field 사용 (`#options: ResolvedCorsOptions`) → 런타임 강제. 또는 `resolveCorsOptions` 출력 객체를 `Object.freeze` (deep freeze 권장). 후자가 더 깔끔.

---

### D-NEW-13. `CORS_DEFAULT_METHODS` 가 frozen 아니어서 import 후 mutation 가능 → 전역 default 변경

**상황**

`src/constants.ts:3`
```ts
export const CORS_DEFAULT_METHODS: string[] = ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'];
```

`const` 선언이지만 배열 자체는 frozen 이 아니라 `.push`/`.shift` 가능. `options.ts:24` 에서 `??` fallback 으로 사용 후 `.map()` 으로 새 배열 생성 — 그러나 mutation 시점이 fallback 적용 전이면 mutated 값이 그대로 반영된다.

**재현 (monorepo workspace 직접 import 시)**

```
import { CORS_DEFAULT_METHODS } from '...constants';
CORS_DEFAULT_METHODS.push('TRACE');
const c = Cors.create({ origin: true });
c.options.methods === ['GET','HEAD','PUT','PATCH','POST','DELETE','TRACE']    ← mutated default 반영
```

**완화 요인**

`package.json` `exports` 가 `"."` 단일 entry 만 노출. `CORS_DEFAULT_METHODS` 는 index.ts 에서 export 안 됨. publish 후 사용자가 deep import 어려움. 그러나 **monorepo workspace 내** (또는 burgled bundler) 에서는 source 직접 import 가능. global state pollution risk.

**코드 위치**

`src/constants.ts:3`

**수정 방향**

`Object.freeze` 적용:
```ts
export const CORS_DEFAULT_METHODS: readonly string[] = Object.freeze(['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE']);
```

타입 선언도 `readonly string[]` 로.

---

### D-NEW-14. `structuredClone(corsError)` 가 `reason` 손실 + 일반 `Error` 로 강등 → worker 경계에서 reason 분기 깨짐

**상황**

`interfaces.ts:46-50` JSDoc: "Inspect {@link reason} to programmatically distinguish error kinds." 가 명시한 contract. 그러나 HTML Standard 의 `structuredClone` algorithm 은 Error 직렬화 시 `name`/`message`/`stack`/`cause` 만 보존하고 own data property (`reason`) 는 버린다. `worker_threads`, `MessageChannel`, `postMessage` 같은 통신 경계에서 `CorsError` 가 직렬화되면 수신측은 `e.reason === undefined` + `e instanceof CorsError === false` 가 된다.

**재현**

```
const err = new CorsError({ reason: 'origin-function-error', message: 'boom', cause: 'src' });
const cloned = structuredClone(err);
cloned.reason                    → undefined          (기대: 'origin-function-error')
cloned.name                      → 'Error'            (기대: 'CorsError')
cloned instanceof CorsError      → false
cloned instanceof Error          → true
```

**영향**

서버 사이드 worker (Bun worker, Node worker_threads), edge runtime (Cloudflare Workers, Deno Deploy), broadcast 패턴 등에서 cors error 를 thread 경계로 전달 시 수신측의 `if (e instanceof CorsError && e.reason === ...)` 분기가 모두 깨진다. JSDoc 계약 위반.

**코드 위치**

`src/interfaces.ts:52-60`

**수정 방향**

`toJSON()` 메서드 정의 + 별도 `fromJSON()` static 또는 `CorsError.deserialize()`. 또는 JSDoc 에 "structuredClone 으로 전달 시 reason 손실" 명시. 단 후자는 contract 회피.

---

### D-NEW-15. `JSON.stringify(corsError)` 에 `message`/`cause`/`stack` 누락 → 진단성 갭

**상황**

표준 `Error` 의 `message` 는 non-enumerable, `cause` 는 `ErrorOptions` 경로로 들어가면 non-enumerable. `JSON.stringify` 는 enumerable own 만 직렬화. 결과적으로 `CorsError` 를 로그/원격 모니터링 시스템에 그대로 `JSON.stringify` 하면 `reason + name` 만 남고 `message`, `cause`, `stack` 누락.

**재현**

```
const err = new CorsError({ reason: 'invalid-max-age', message: 'oops', cause: 'src' });
JSON.stringify(err)
→ {"reason":"invalid_max_age","name":"CorsError"}

Object.getOwnPropertyDescriptor(err, 'message')
→ { value: 'oops', writable: true, enumerable: false, configurable: true }

Object.getOwnPropertyDescriptor(err, 'cause')
→ { value: 'src', writable: true, enumerable: false, configurable: true }
```

**영향**

운영 로깅이 `JSON.stringify` 기반이면 디버깅 컨텍스트 손실. 표준 Error 동작이라 사양 위반은 아니지만 API 진단성 갭.

**코드 위치**

`src/interfaces.ts:52-60`

**수정 방향**

`toJSON()` 메서드 추가:
```ts
toJSON() {
  return { name: this.name, reason: this.reason, message: this.message, cause: this.cause, stack: this.stack };
}
```

D-NEW-14 와 같은 fix.

---

### D-NEW-16. `CorsErrorData` 가 `@internal` 마킹인데 `index.ts` barrel 로 public export — 캡슐화 누출

**상황**

`src/interfaces.ts:36-42`
```ts
/**
 * Error data payload used internally with the Result pattern.
 * @internal
 */
export interface CorsErrorData { ... }
```

`@internal` JSDoc 으로 명시되었지만 `index.ts:8-13`
```ts
export type {
  CorsOptions,
  CorsErrorData,    // ← @internal 인데 public barrel export
  ...
};
```

외부 사용자가 internal type 에 의존하게 되면 breaking change 위험. `@internal` 시그널 무력화.

**재현**

`grep CorsErrorData` 두 파일에서 확인. interfaces.ts 에 `@internal` 마킹 + index.ts 에 export.

**코드 위치**

`src/interfaces.ts:36-42`, `index.ts:8-13`

**수정 방향**

`index.ts` 에서 `CorsErrorData` export 제거. 또는 `@internal` 마킹 제거 후 public 으로 contract.

---

### D-NEW-17. `CorsAction` / `CorsRejectionReason` / `CorsErrorReason` enum 객체가 frozen 아니어서 wire value tamper 가능 → cors.handle 결과 변조

**상황**

TypeScript `enum` 은 런타임에 일반 객체로 컴파일됨. `Object.isFrozen(CorsAction) === false`. 외부 코드가 `(CorsAction as any).Continue = 'tampered'` 로 enum 멤버 자체를 변경하면 `cors.ts:87, 139, 144` 의 `{ action: CorsAction.Continue }` reference 가 변경된 값을 반환. 모든 후속 `cors.handle()` 결과가 변조된다.

**재현**

```
before: CorsAction.Continue === 'continue'
(CorsAction as any).Continue = 'tampered'
after: CorsAction.Continue === 'tampered'
cors.handle(req).action === 'tampered'   ← wire/contract 깨짐
```

다른 미들웨어 / shared module / monkeypatch 라이브러리 등이 이 enum 을 건드릴 수 있는 모든 경로에서 위험.

**코드 위치**

`src/enums.ts:5-12, 17-26, 31-48`

**수정 방향**

enum 객체에 `Object.freeze`:
```ts
export const CorsAction = Object.freeze({
  Continue: 'continue',
  RespondPreflight: 'respond-preflight',
  Reject: 'reject',
} as const);
export type CorsAction = typeof CorsAction[keyof typeof CorsAction];
```

const enum + assertion 패턴 또는 `as const` 객체로 변환. 추가 비용은 트리쉐이킹 안전성 약간 개선.

---

### D-NEW-18. `CorsResult` 반환 객체가 frozen 아니어서 caller 가 action/reason/headers 변조 가능 → downstream 미들웨어/router 영향

**상황**

`cors.handle()` 가 반환하는 `CorsContinueResult` / `CorsPreflightResult` / `CorsRejectResult` 객체가 `Object.freeze` 안 되어 있다. caller (예: `corsMiddleware` 본체 또는 downstream code) 가 `result.action = CorsAction.Continue` 또는 `result.reason = ...` 같이 mutation 가능. middleware.ts:40-65 는 그 자체로 cors 가 emit 한 결과를 그대로 신뢰하지만, 다른 미들웨어 코드가 결과 객체에 접근하면 변조 가능.

**재현**

```
const r = await cors.handle(req)
// r.action === 'reject', r.reason === 'origin-not-allowed'
(r as any).reason = 'no-origin'       ← 변조 가능
(r as any).action = 'continue'        ← 변조 가능
```

downstream consumer 가 `r.action` 으로 분기하는 코드가 영향. Cors 인스턴스가 그 결과를 보관하지 않으므로 다음 요청에는 영향 없지만, **현재 요청의 처리 흐름 변조** 가능.

**코드 위치**

`src/cors.ts:87, 139, 143-145`, `src/interfaces.ts:10-32`

**수정 방향**

`cors.ts:87, 139, 143-145` 에서 반환 직전 `Object.freeze(result)`. 또는 headers 까지 deep freeze.

---

### DN-3. Trailing slash 가 포함된 origin 옵션이 검증 우회 후 wire 위반 emit ✅ CLOSED (2026-05-26)

**해결 경로**: RFC 6454 §6.2 serialized origin (`scheme "://" host [":" port]`) 와 1:1 매칭. WHATWG `URL` 파서의 `.origin` 정규화 출력 (소문자 scheme/host, default port 제거, trailing slash/path/query/fragment 제거, IDN punycode) 와 입력 문자열을 byte 비교 — 차이가 있으면 reject. `'*'` / `'null'` (opaque origin) 은 short-circuit 통과.

**적용된 변경**:
- `options.ts` 에 helper `validateOriginString(value)` + `describeOriginViolation(value, failure)` 신설. 두 실패 분기 (parse fail / canonical mismatch) 의 에러 메시지 분리.
- `validateCorsOptions` 의 single string + array entry 분기에 적용. array 분기는 `for` 루프 + `origin[N]: ...` 메시지 echo.

**테스트 (RED→GREEN)**:
- `options.spec.ts`: trailing slash / uppercase / default port / path / parse-fail / `'null'` literal / IPv6 / array entry index echo — 8 RED → GREEN
- `cors.spec.ts`: boundary 1건 (`Cors.create({origin:'https://a.com/'})` throws InvalidOrigin)
- 결과: 270 pass / 0 fail

**BREAKING 표면**: trailing slash, uppercase scheme/host, default port (`:443`/`:80`), IDN Unicode, path/query/fragment 가 boot reject 로 전환. RFC 6454 위반이 silent wire emit 되던 동작이 fail-fast 됨. 정상 사용자 영향 0, 잘못된 origin 작성자만 boot 단계에서 인식.

**별도 결함 (D-NEW-2 분리)**: OriginFn 반환값의 CR/LF 검증은 runtime path (`cors.ts` `resolveOriginResult`) 책임축 + RFC 9113 field-value ABNF. DN-3 와 다른 결함, 별도 commit.

**12차 업데이트 (2026-05-27)**: baker 3.1.0 `isCorsOrigin` 으로 마이그레이션. 로컬 helper `validateOriginString`, `describeOriginViolation` 제거. `isBlank` 함수 + `options.spec.ts` 의 `describe('isBlank')` 5 케이스도 제거 (`isCorsOrigin` 이 빈 문자열/공백/탭 모두 false 반환하므로 통합). 메시지는 parse/mismatch 분기 통합 + entry index/value echo 유지.

---

## 3. 강화 후보 — 사양 의무 아님 (4건)

사양이 요구하지 않으나 보안/캐시 효율/일관성 측면 강화 후보. 산업 5/5 라이브러리 모두 처리하지 않는 영역이므로 zipbul 차별화 기회.

(DN-31 은 11차에서 본 섹션에 분류됐으나 RFC 9110 §5.6.2 token ABNF 위반 카테고리로 §2 로 재분류. 본 섹션의 DN-31 본문은 카테고리 표시만 사양 위반으로 변경되며 위치는 발견 순서 보존.)

### [§2 사양 MUST 위반으로 재분류] DN-31. Wildcard `'*'` 비교 규칙 비대칭 — token ABNF 위반 padded `' * '` 통과

본 결함은 RFC 9110 §5.6.2 `token = 1*tchar` (공백 불허) 부합 안 하는 padded wildcard 토큰을 옵션 검증에서 통과시키고, `serializeExposeHeaders`/`areRequestHeadersAllowed` 에서 wildcard 인식 비대칭으로 wire 에 잘못된 값 emit. **D3 와 같은 token ABNF 위반 카테고리**. 11차에서 일관성 결함으로 분류했으나 정확한 기준 (사양 verbatim 부합) 적용 시 사양 MUST 위반.

원래 텍스트:

**상황**

`cors.ts:293` 의 `includesWildcard(values)` 는 `values.some(v => v === '*')` 로 **strict equality** 검사한다. 반면 같은 파일 line 217 (`serializeExposeHeaders`) 와 line 258 (`areRequestHeadersAllowed`) 의 wildcard 제거 filter 는 `h.trim() !== '*'` 로 **trim 후 비교**한다. 진입 조건과 처리 규칙이 비대칭.

결과적으로 padded wildcard 토큰 `' * '` 는:
- 단독으로 있을 때 → `includesWildcard` 가 인식 못해 wildcard 처리 안 됨, 그대로 join 되어 ACEH wire 에 `' * '` (앞뒤 공백) 또는 brower-side trim 후 `'*'` 송출 → 사용자 의도 불명
- `'*'` 와 같이 있을 때 → filter 의 `trim() !== '*'` 로 인해 둘 다 제거됨

**사양 근거**

RFC 9110 §5.6.2 `token = 1*tchar` (공백 불허) → `' * '` 자체가 ABNF 위반. 다만 검증 측 `isBlank(' * ')` 는 trim 후 길이 1 이라 false → boot 통과.

**코드 위치**

`src/cors.ts:293` — `values.some(value => value === '*')`
`src/cors.ts:217` — `exposedHeaders.filter(header => header.trim() !== '*')`
`src/cors.ts:258` — `allowedHeaders.filter(header => header.trim() !== '*')`

**재현 (bun 실행)**

```
exposedHeaders=[' * '] alone, no creds → ACEH="*"   (Bun Headers trim 효과로 wildcard 처럼 보이지만 검증 로직은 모르고 통과)
exposedHeaders=[' * ','X-A'], no creds → ACEH="* ,X-A"  (앞뒤 공백 포함된 wire)
exposedHeaders=['*',' * ','X-A'] + creds → ACEH="X-A"   (두 wildcard 모두 제거됨)
```

**수정 방향**

진입과 filter 의 비교 규칙 통일. 둘 다 `=== '*'` (strict) 또는 둘 다 `trim() === '*'`. token 문법 검증 (D3 와 묶어 RFC 9110 token regex) 으로 `' * '` 자체를 boot 거부하는 게 더 깔끔.

### DN-32. OriginFn 이 영구 pending Promise 반환 시 `Cors.handle` 무한 hang

**상황**

`cors.ts:185-198` 의 `safe()` wrapper 는 OriginFn 호출 시 `await` 한다. OriginFn 이 영구 pending Promise 를 반환하면 (`() => new Promise(() => {})`), `safe` 도 영원히 await, `Cors.handle` 도 영원히 await. abort signal / timeout 우회 없음. `Request.signal` 미사용.

**상황 시나리오**

사용자 OriginFn 이 DB/HTTP/Redis 등 외부 의존을 호출하는데 그 의존이 hang 하는 경우. 연결이 endpoint 까지 도달 못한 채 무한 hang. connection leak.

**사양 근거**

사양 MUST 아님. 가용성 영역.

**재현 (bun 실행)**

```
입력: Cors.create({ origin: () => new Promise(() => {}) })
     + Request GET, Origin: 'https://a.com'
1초 후 Promise.race 결과: HUNG (no timeout/abort)
```

**수정 방향**

`Request.signal` 을 OriginFn 에 전달하거나, `Cors.handle` 에 `signal: AbortSignal` 옵션 추가. 또는 사용자 책임 명시 (JSDoc 에 "OriginFn must resolve or reject; pending Promises will hang"). 사양 의무는 아니므로 정책 결정.

---

### DN-1 / DN-2. Forbidden method (`CONNECT` / `TRACE` / `TRACK`) advertise 가능

**상황**

`Cors.create({ origin: true, methods: ['TRACE'] })` 가 통과하고 `Access-Control-Allow-Methods: GET,TRACE` 가 wire 에 흘러간다. `methods: ['*']` 도 마찬가지로 ACRM `TRACK` 을 통과시킨다.

**사양 근거**

Fetch §2.2.1: "A forbidden method is a method that is a byte-case-insensitive match for `CONNECT`, `TRACE`, or `TRACK`." 다만 같은 절: "**These are forbidden so the user agent remains in full control over them.**" → UA-side 책임이므로 서버가 advertise 한다고 사양 MUST 위반은 아니다.

**맥락**

XST (Cross-Site Tracing) 와 HTTP smuggling 우려. UA 가 어차피 보내지 않으므로 광고 자체는 무의미하지만 NGINX/리버스 프록시 환경에서 사이드 채널 위험이 있다.

**수정 방향**

옵션 strict 모드에서 forbidden method 거부. default 비활성화 가능.

### DN-30. Wildcard allowedHeaders + credentials + ACRH 부재 시 ACAH 미발행

**상황**

`Cors.create({ origin, allowedHeaders: ['*'], credentials: true })` + ACRH 없는 preflight 시 `cors.ts:281-287` 가 `undefined` 반환하여 ACAH 가 set 되지 않는다. UA 가 후속 actual request 에 헤더를 추가할 때 cache miss 가능.

**사양 근거**

사양 명시 MUST 없음. UA preflight cache 효율성만 영향.

**수정 방향**

옵션 fallback 으로 빈 string `''` 또는 `*` 발행. 단 현재 동작이 사양 위반은 아니므로 우선순위 낮음.

---

## 4. 테스트 품질 (7건)

### Q1. `options.spec.ts:648-737` V_regex 7 케이스가 죽은 테스트

**상황**

7개 케이스가 모두 "RegExp origin 옵션이 통과해야 한다" 만 검증하지만 `options.ts:54-134` 의 `validateCorsOptions` 에는 RegExp 안전성/구조를 검증하는 분기가 단 하나도 없다. 어떤 RegExp 든 모두 통과한다. 따라서 이 7개 테스트는 회귀 검출력이 0이며 단지 라인을 채우는 죽은 코드다.

**근거**

`grep -i 'regex\|RegExp' src/options.ts` → 0 hit (RegExp 처리 로직 없음).

**수정 방향**

(a) 검증 로직을 실제로 추가하고 테스트를 의미있게 만들기, (b) 7개 케이스 제거. 사양상 RegExp 안전성 검증 의무는 없으므로 (b) 가 자연스럽다.

### Q2. 약한 어설션 — 헤더 값 미검증

**상황**

`cors.spec.ts:172, 182, 207-208, 226-228, 484-493, 743-755` 등에서 `assertContinue(result)` / `assertPreflight(result)` 만 호출하고 헤더 값을 검증하지 않는 케이스가 다수. 미들웨어가 잘못된 ACAO/ACAH 값을 emit 해도 action 분기만 맞으면 테스트 통과.

**재현**

bun 실행으로 `cors.spec.ts:484-493` 의 케이스가 코드 mutation 시뮬레이션 시 action 통과 + 헤더 값 변조를 검출 못함 입증.

**수정 방향**

각 케이스에 `expect(headers.get('access-control-allow-headers')).toBe('...')` 같은 wire-level 값 검증 추가.

### Q3. `arrayContaining` / `toContain` 어설션이 순서·여분 검출 불가

**상황**

`methods.test.ts:19` 의 `expect(allow).toEqual(expect.arrayContaining(['POST', 'PUT']))` 는 결과가 `['POST', 'PUT', 'UNEXPECTED']` 여도 통과한다. `cors.ts:235-237` 의 `serializeAllowedMethods` 가 `methods.join(',')` 로 순서 결정적이므로 `toEqual(['POST', 'PUT'])` 로 정확 일치를 단언해야 한다. `preflight.test.ts:54` 의 `.toContain('POST')` 도 동일 약점.

**재현**

bun: `['POST', 'PUT', 'UNEXPECTED']` 도 `arrayContaining` 통과 입증.

**수정 방향**

`toEqual` 또는 `toBe(text)` 로 정확 매칭. `methods.test.ts:17-20` 의 split/parse 로직도 제거하고 wire 그대로 `expect(allow).toBe('POST,PUT')`.

### Q4. `Origin: 'null'` literal 매칭이 unit 미커버

**상황**

e2e `origin-matching.test.ts:124-148` 에서 opaque origin (`Origin: null` literal) 매칭 케이스가 있지만 unit `cors.spec.ts` 에는 부재. unit 레벨에서 `origin: 'null'` 옵션 + `Origin: 'null'` 요청의 정확한 매칭을 단언하는 케이스 없음.

**수정 방향**

unit 에 `Cors.create({ origin: 'null' })` + Request with `Origin: 'null'` → reflect, ACAO: 'null' 검증.

### Q5. 일관성 결함 — 명명/AAA/표기/언어 혼재

- 헤더 이름: unit (`cors.spec.ts`) 는 `HttpHeader.AccessControlAllowOrigin` enum, e2e 는 `'access-control-allow-origin'` literal — 혼재
- AAA 주석: `cors.spec.ts:75-84` 등 일부 `// Arrange / Act / Assert` 사용, 같은 파일 다른 케이스(`108-114`, `231-253` 등) 생략
- 섹션 주석 한/영 혼재: `options.spec.ts:323, 451, 516, 572, 628` 에 `── origin 신규 검증 ──` 같은 한국어 섹션과 영어 describe 명 혼재
- e2e 의 `preflight()` 헬퍼: `helpers.ts:69-78` 정의되어 있으나 `vary-header.test.ts:42-49` 는 inline 으로 OPTIONS 요청 직접 구성

**수정 방향**

스타일 가이드 통일. 헤더 이름은 어디에서나 enum 사용. AAA 주석은 모두 사용 또는 모두 제거. 한/영 혼재 제거. helpers 헬퍼 재사용 강제.

### U6. Preflight 경로 prior Vary 보존 e2e 부재 (D2 회귀 표면)

**상황**

`test/e2e/pipeline.test.ts:14-26` 가 prior Vary 보존을 검증하지만 non-preflight (Continue) 경로만. D2 결함이 발생하는 preflight 경로는 검증 없음.

**수정 방향**

`pipeline.test.ts` 에 preflight (`OPTIONS + ACRM`) 케이스 추가. prior `Vary: Accept-Encoding` 후 preflight → 응답 Vary 에 `Accept-Encoding` 보존 검증.

### §4.10 사양 인용 부정확

**상황**

`allowed-headers.test.ts:39`, `methods.test.ts:62`, `origin-matching.test.ts:162`, `origin-matching.test.ts:188` 에 "Fetch §4.10" 인용이 있다. Fetch §4.10 은 UA 측 CORS check 알고리즘이고, preflight 거부 시 서버 silent return 동작은 §4.8 (CORS-preflight fetch) 측에서 더 직접적으로 기술된다.

**수정 방향**

인용을 §4.8 로 수정하거나 인용 자체 제거 (테스트 명만으로 의도 명확).

---

## 5. 결함 아님 (이전 의심 철회)

검증 과정에서 의심했으나 사양/코드/재현 검증 후 결함이 아닌 것으로 확정한 항목들. 향후 재논의 방지 목적으로 기록.

- **enum-spec self-ref**: `enums.spec.ts:7-11, 20-25, 35-44` 의 `expect({...CorsAction}).toEqual({...})` 가 자기참조라 새 멤버 추가 검출 불가하다고 주장했으나, 두 에이전트 시뮬레이션 결과 Bun `toEqual` 가 extra key 를 검출함. 결함 아님.
- **U2 부분 매칭 ACRH**: `allowedHeaders: ['X-A']` + ACRH `'X-A, X-B'` 가 reject 되어야 하는지 검증. bun 재현 결과 정상적으로 `header_not_allowed` 로 reject. 코드 정상.
- **e2e status/body 검증**: 404/500/Content-Length:'0'/body:'' 어설션이 라우터/프레임워크/어댑터 책임 영역 검증으로 보여 스코프 침범 의심. 그러나 e2e 의 역할은 wire-level 통합 결과 검증이며, CORS 미들웨어 동작이 야기한 wire 관찰 결과는 모두 정당한 e2e 어설션. 침범 0건.
- **동시 요청 시 RegExp lastIndex leak**: `/g` flag regex 가 동시 요청에서 상태 leak 가능성 의심. `cors.ts:168, 175` 의 `lastIndex = 0` reset 으로 격리됨. 동시 4 요청 재현 통과.
- **HTTP/2 case handling**: `HttpHeader` enum 전량 lowercase, Bun `Headers` case-fold. 충돌 없음.
- **PNA `ACRPN: 'TRUE'` 거부**: 사양에 case 명시 없음. 코드의 case-sensitive 매칭은 보수적 정합 선택.
- **OPTIONS method case-sensitivity**: `new Request()` 가 method 를 정상화하므로 `request.method !== 'OPTIONS'` 비교 안전.
- **테스트 파일 `test/cors.test.ts`, `test/middleware.test.ts`**: colocated unit (`src/cors.spec.ts`, `src/middleware.spec.ts`) 의 부분집합. 이미 삭제됨.

---

## 6. 구조적 커버리지

코덱스 6차 전수 verify 결과:
- 라인 커버리지 100%
- `cors.ts` / `middleware.ts` / `options.ts` 의 60+ 분기 모두 true/false 양쪽 커버

결함은 모두 "**빠진 분기**"(검증 코드 자체가 존재하지 않음) 에서 발생. 기존 분기는 모두 테스트됨.

---

## 7. 산업 비교 종합

| 결함 | zipbul | expressjs/cors | @fastify/cors | hono/cors | koa-cors |
|---|:---:|:---:|:---:|:---:|:---:|
| D1 (uppercase 강제) | ❌ | ✅ | ✅ | ✅ | ✅ |
| D2 (prior Vary 손실) | ❌ | ✅ vary merge | ✅ vary merge | ⚠️ preflight | ✅ vary merge |
| D3 (invalid token emit) | ❌ | ❌ | ❌ | ❌ | ❌ |
| D5 (originFn `'*'` + creds) | ❌ | ❌ | ❌ | ❌ | ⚠️ swap |
| D6 (invalid ACRH echo) | ❌ | ❌ | ❌ | ❌ | ❌ |
| D7 (ACAM:* + ACAC) | ❌ | ❌ | ❌ | ❌ | ❌ |
| G5 (multi-value Origin) | ❌ | ❌ | ❌ | ❌ | ❌ |
| DN-3 (trailing slash) | ❌ | ❌ | ❌ | ❌ | ❌ |

- **D1 / D2 는 zipbul 단독 회귀** (산업 5/5 또는 3/5 회피)
- **D3 / D5 / D6 / D7 / G5 / DN-3 는 산업 5/5 공통** (zipbul 차별화 기회로 strict 모드 가능)
- **D5 의 koa swap 우회는 임의 origin 허용이라는 다른 위험** — zipbul 의 strict throw 가 더 안전

---

## 8. 검증 과정 요약

| 차수 | 검증 영역 | 결과 |
|---|---|---|
| 1차 | 코드 라인 단위 + 사양 인용 | 추측 다수, 정정 필요 |
| 2차 | 사양 verbatim + 재현 | D1/D2/D3 확정 |
| 3차 | 스코프 매트릭스 + 사양 확장 | D5/D6/D7/G5 추가 확정 |
| 4차 | 추론 항목 bun 재현 | enum-spec/U2 결함 아님 철회, 스코프 침범 0 확정 |
| 5차 | 사양 전수 (Fetch §4.8/§4.10, RFC 6454/9110) + 분기 매트릭스 | DN-3 추가, 라인/분기 100% 확인 |
| 6차 | RFC 9111 + HTTP/2 + 라이브러리 비교 + 동시성 | 신규 0, D1/D2 가 zipbul 단독 회귀 확정 |
| 7차 | RFC 9113/9114, WebSocket/SSE, Service Worker, Proxy/CDN, PNA secure context | 신규 0, out-of-scope 명시 |
| 8차 | matchOrigin 엣지, Cors 재사용, CorsError, 검증 순서, 분기 결합, PNA 다중값, Vary 결합, maxAge 엣지, exposedHeaders 엣지, 호출 contract | **신규 3건** (D-NEW-1/2/3) |
| 9차 | 옵션 nested mutation, 검증 순서 보안, wildcard 비교 비대칭, deadlock, wrong-type, credentials truthy | **신규 4건** (D-NEW-4/5 사양 MUST, DN-31/32 강화) — 12차에서 D-NEW-4/5 모두 type 우회 trigger 로 재분류, 결함 catalog 제외 |
| 10차 | boolean 옵션 비대칭(allowPrivateNetwork/preflightContinue), null silent coerce, origin object→OriginFn 오분류, private ctor 미강제, throw undefined cause 부재 | **신규 6건** (D-NEW-6~11) — 12차에서 D-NEW-6/7/8/9 모두 type 우회 trigger 로 재분류, 결함 catalog 제외 |
| 11차 | export surface, enum wire 영구성, 상수 mutation, freeze 부재, CorsError serialization | **신규 7건** (D-NEW-12~18) |
| 12차 | baker 3.1.0 `isOrigin`/`isCorsOrigin` 도입 + DN-3 마이그레이션 (로컬 helper → baker rule, `isBlank` 통합 제거) + D-NEW-2 fix (OriginFn 반환값 sanitize, wildcard 분기 2-branch 보존: Fetch §3.3.5 wire 결함 vs RFC 6454 §6.2 직렬화 결함 의미축 분리) | **신규 0건**, 기존 2건 CLOSED + **1건 BREAKING** (빈 문자열 OriginFn 반환: silent reject → InvalidOriginReturn throw, 거부 신호는 `return false` 통일) |
| 13차 | D-NEW-1 fix (maxAge wire ABNF 위반): boot validation 에 `>= 1e21` 상한 추가, `CORS_MAX_AGE_EXPONENTIAL_THRESHOLD` 상수화, ECMAScript §6.1.6.1.30 + RFC 9111 §1.2.2 인용. v1 (isSafeInteger 교체) 은 실측 결과 1e20/2^53 등 wire 정상 영역까지 과잉 차단 발견 후 self-correct → `>= 1e21` 정확 임계 채택 | **신규 0건**, 기존 1건 CLOSED, no breaking |
| 14차 | D-NEW-3 (옵션 배열 reference 보존) 결함 카탈로그에서 제외. "공격자가 사용자 process 의 JS 변수를 mutate 한다" 시나리오가 이미 RCE 단계 — CORS 책임 영역 아님. 사용자가 자기 옵션 배열을 외부에 노출/mutate 하는 것은 사용자 코드 패턴 책임 (D-NEW-4~9 와 같은 사용자 책임 카테고리). §1 매트릭스 (13건→12건) + D-NEW-3 본문 삭제 + type-guaranteed 정책 노트에 사유 부기 — *15차에서 baker schema 일원화 + array shallow clone 도입으로 미들웨어가 자연 격리하므로 closed 로 재분류함* | **신규 0건**, 1건 제외 (CLOSED 아님 — 결함 분류 정정) |
| 15차 | **옵션 검증 baker 3.3.0 schema 일원화**: `CorsOptions` 를 데이터 클래스로 promotion (`@Recipe` + `@Field`) + `validateCorsOptions`/`resolveCorsOptions` 함수 폐기 + `options.ts`/`options.spec.ts` 파일 삭제 (87 boundary 검증은 신규 `cors-options.spec.ts` 로 마이그레이션). `Cors.create` 가 baker `validateSync(CorsOptions, merged)` 호출 + post-validate cross-check (credentials + wildcard origin/methods) + methods `'*'` 정규화 + array shallow clone + deep freeze + new Cors. baker custom rule 0 — origin union 은 `oneOf(isBoolean, isCorsOrigin, isStatelessRegExp, arrayEvery(oneOf(isCorsOrigin, isStatelessRegExp)), isFunction)`. **D-NEW-3 (사용자 array mutation) 정책 flip**: clone 도입으로 미들웨어가 격리 — 14차 "제외" → 15차 "closed". `CORS_DEFAULT_METHODS` `Object.freeze` 적용. `cors.ts` 의 RegExp `lastIndex` reset 두 줄 제거 (stateless RegExp 만 통과). `CorsError` instance `Object.freeze` 적용. baker NaN context 누락 우회로 cors.ts 에 path 기반 fallback reason 매핑 추가 (path → CorsErrorReason) | **신규 0건**, **2건 CLOSED** (D-NEW-3 격리, baker schema 일원화), **BREAKING 1건** (origin RegExp 의 `/g`·`/y` flag boot reject — stateful matcher 패치워크 폐기) |

각 차수 결과는 3자 cross-verify (나 / 서브에이전트 / 코덱스) + bun 실행 재현으로 검증.

---

## 9. 사용한 사양/도구

| 사양 | 파일 경로 | 용도 |
|---|---|---|
| Fetch Living Standard (2026-05-08 snapshot) | `/tmp/cors-review/fetch-spec.html` 1.9MB / `.txt` 306KB | CORS 프로토콜 §3.3, preflight §4.8, CORS check §4.10 |
| WICG Private Network Access | `/tmp/cors-review/pna-spec.html` 248KB / `.txt` 57KB | PNA §2.3, §3.4 |
| RFC 6454 (Origin) | `/tmp/cors-review/rfc6454.txt` 41KB | Origin serialization §6 |
| RFC 9110 (HTTP Semantics) | `/tmp/cors-review/rfc9110.txt` 503KB | Methods §9, Token §5.6.2, Vary §12.5.5 |
| RFC 9111 (HTTP Caching) | `/tmp/cors-review/rfc9111.txt` 84KB | Vary 매칭 §4.1, delta-seconds §1.2.2 |
| RFC 9113 (HTTP/2) | `/tmp/cors-review/rfc9113.txt` 192KB | Header lowercase §8.2 |
| RFC 9114 (HTTP/3) | `/tmp/cors-review/rfc9114.txt` 155KB | Header lowercase §4.2 |

라이브러리 소스:
- `node_modules/.bun/cors@2.8.6/node_modules/cors/lib/index.js`
- `node_modules/.bun/@fastify+cors@11.2.0/node_modules/@fastify/cors/index.js`
- `node_modules/.bun/hono@4.12.18/node_modules/hono/dist/middleware/cors/index.js`
- `koa-cors` master (raw.githubusercontent)

재현 코드는 `/tmp/cors-review/` 에 보존:
- `repro-*.ts` (zipbul 결함 재현)
- `repro-expressjs.mjs`, `repro-fastify.mjs`, `repro-hono.mjs` (라이브러리별 8 결함 재현)
- `bun-h2-case.ts`, `bun-ws-sse-trailer.test.ts`, `bun-vary-collision.test.ts` (7차 영역 재현)

---

## 10. verify 못한 영역 (정직 보고)

- RFC 7540 (HTTP/2 obsolete) 의 deprecated 사용 사례
- 실제 Cloudflare / CloudFront / Fastly 등 CDN 의 휴리스틱 캐시 동작 실측 (RFC 9111 §4.2.2 책임 분만 확인)
- WebSocket Subprotocol Origin 검증 (RFC 6455 영역, CORS 사양 외)
- HTTP/3 의 어댑터 wire-level emit 동작 (어댑터 책임 영역)
- Service Worker / Edge Worker (Cloudflare Workers, Deno Deploy, Vercel Edge) 환경에서의 미들웨어 실행 여부 (런타임 의존)
- proxy/CDN 환경에서 Vary 헤더 누적 실측

이 영역에서 추가 결함 가능성을 완전히 배제할 수 없으나, 사양/코드 매핑에서 미들웨어 책임 분이 식별되지 않았다.
