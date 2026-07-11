# CORS 미들웨어 업계 대조 보고서

**기준**: `STANDARDS.md`의 27개 규칙 (2026-07-10 스냅샷).
**대상**: 6개 생태계 13개 메이저 구현 + zipbul.
**방법**:
- **JS/TS 6종** — 실제 기동 후 wire 대조(런타임 검증). 각 라이브러리를 3개 설정(A: 정적 `*` 기본 / B: 화이트리스트+credentials+maxAge+expose / C: 와일드카드 헤더·메서드+credentials)으로 띄우고 12개 프로브(P1–P12)를 curl 원시 헤더로 채집.
- **비-JS 7종** — GitHub main/master 원본 소스 전문 감사(코드 검증). 함수 단위 인용.
- 검증일 2026-07-10. JS 버전 고정: `cors@2.8.6`(express 5.2.1) · `@fastify/cors@11.3.0`(fastify 5.10.0) · `hono@4.12.29` · `@koa/cors@5.0.0`(koa 3.2.1) · `@elysiajs/cors@1.4.2`(elysia 1.4.29) · `h3@2.0.1-rc.23`.

**판정 규약**
| 기호 | 의미 |
|--|--|
| ✅ PASS | 코드가 규칙을 구조적으로 보장 |
| ⚙ CONFIG | 라이브러리는 중립 — 검증 없는 설정 통과로 위반 wire가 가능하나 기본값은 준수 |
| ◐ PARTIAL | 일부 경로·설정에서만 위반 |
| ❌ FAIL | 어떤 설정으로도 막을 수 없거나 기본 동작이 위반 |
| — N/A | 미들웨어 소관 밖(§5.1 Location, §8.1·§8.2 운영 판단) 또는 조건부 규칙의 트리거 기능 미구현(§6.x) |

---

## 1. 종합 순위

FAIL 수 → PARTIAL 수 순. 준수율 = (PASS+CONFIG) / (27 − N/A).

| 순위 | 구현 (생태계) | PASS | ⚙ | ◐ | ❌ | N/A | 준수율 | FAIL 규칙 |
|--:|:--|--:|--:|--:|--:|--:|--:|:--|
| 1 | **tower-http** (Rust/axum) | 13 | 8 | 2 | **0** | 4 | 91% | — |
| 2 | **Spring** (Java) | 19 | 1 | 3 | **0** | 4 | 87% | — |
| 3 | **django-cors-headers** (Python) | 16 | 6 | 0 | 1 | 4 | 96% | §7.2 |
| 4 | **actix-cors** (Rust) | 15 | 4 | 3 | 1 | 4 | 83% | §7.2 |
| 5 | **rs/cors** (Go) | 17 | 1 | 3 | 2 | 4 | 78% | §1.5 §7.2 |
| 6 | **ASP.NET Core** (C#) | 15 | 4 | 1 | 2 | 5 | 86% | §7.1 §7.2 |
| 7 | **zipbul** (Bun, 조사 시점) | 17 | 1 | 2 | 3 | 4 | 78% | §1.5 §7.1 §7.2 → **전부 수정됨(하단 갱신)** |
| 7 | **Starlette/FastAPI** (Python) | 17 | 2 | 1 | 3 | 4 | 83% | §1.5 §7.1 §7.2 |
| 9 | **h3** (JS/Nuxt) | 12 | 6 | 1 | 3 | 5 | 82% | §1.5 §3.7 §7.1 |
| 10 | **cors** (JS/Express·NestJS) | 11 | 7 | 1 | 3 | 5 | 82% | §1.5 §3.5 §3.7 |
| 10 | **@fastify/cors** (JS) | 11 | 7 | 1 | 3 | 5 | 82% | §1.5 §3.5 §3.7 |
| 10 | **hono** (JS) | 11 | 7 | 1 | 3 | 5 | 82% | §1.5 §3.5 §3.7 |
| 13 | **@koa/cors** (JS) | 11 | 7 | 2 | 3 | 4 | 78% | §1.5 §3.5 §3.7 |
| 13 | **@elysiajs/cors** (Bun) | 10 | 7 | 2 | 3 | 5 | 77% | §1.5 §3.5 §3.7 |
| 15 | **gin-contrib/cors** (Go) | 12 | 5 | 3 | 3 | 4 | 74% | §3.4 §7.1 §7.2 |
| 15 | **flask-cors** (Python) | 15 | 2 | 3 | 3 | 4 | 74% | §1.5 §3.4 §7.1 |

준수율만으로 줄 세우면 오독한다 — django(96%)의 유일한 FAIL은 무해한 letter 위반이고, express(82%)의 FAIL은 credentials 하에서 preflight를 실제로 깨뜨린다. **FAIL의 종류가 준수율보다 중요하다.**

> **갱신 2026-07-11** — 위 표는 조사 시점(2026-07-10) 스냅샷이다. 이후 zipbul의 FAIL 3건(§1.5·§7.1·§7.2)과 PARTIAL(§1.2/§1.3 origin 함수 반환값 미검증)을 TDD로 전부 수정했다(e2e 286 pass). 수정 중 추가 발견된 성공 경로 Vary 술어 결함(origin 함수가 `'*'`를 반환한 요청에서 Vary 누락 — 캐시가 와일드카드 grant를 거부 대상 origin에 재사용 가능)도 함께 제거했다. **수정 후 zipbul: FAIL 0 · PARTIAL 0 — §1.5+§7.1+§7.2+§3.5+§3.7 동시 통과는 14개 구현 중 유일.**

---

## 2. 규칙별 위반 분포 — 업계 공통 패턴

### §1.5 빈 list 원소 에코 — **14개 중 11개 위반. 업계 표준 결함.**
클라이언트 `Access-Control-Request-Headers: "X-Foo ,, x-bar"`를 그대로 `Access-Control-Allow-Headers`로 되쏘아 RFC 9110 §5.6.1.1(*"a sender MUST NOT generate empty list elements"*)을 위반.
- ❌ express·fastify·hono·koa·elysia·h3 (전부 런타임 실증, P3/P8), rs/cors(`cors.go:381`, 심지어 빈 원소를 16개까지 관용 후 원문 에코), Starlette(`preflight_response`), flask-cors(`.*` 정규식이 빈 원소를 매치해 재방출), tower-http(`mirror_request` 경로 ◐), actix-cors(`allow_any_header` 경로 ◐), **zipbul**(`serializeAllowedHeaders` reflect 경로)
- ✅ **django-cors-headers·gin·Spring·ASP.NET** — 에코 자체를 안 하거나(설정 조인), 분해 후 재조립(Spring `checkHeaders`의 blank 필터, ASP.NET `GetHeaderSplit`의 empty drop)

### §7.1 / §7.2 캐시 규칙 — 가장 변별력 있는 축
| | §7.1 (동적 origin: 거부·무Origin 응답에도 `Vary: Origin`) | §7.2 (정적: 모든 응답에 항상 ACAO + Vary 금지) |
|:--|:--|:--|
| 둘 다 ✅ | **tower-http 유일** (설정에서 Vary 도출: 동적이면 전 응답 Vary, 정적이면 무Origin에도 ACAO+Vary 생략) | |
| §7.1만 ✅ | rs/cors(조기 return 전에 무조건 Vary), Spring(검사 전 Vary 3종), django(`patch_vary_headers`가 게이트 앞), express·fastify·hono·koa·elysia(P4/P7 실증) | |
| §7.1 ❌ | **h3**(성공 경로만 Vary — P4/P7 실증), ASP.NET(`IsOriginAllowed` 조기 return이 Vary보다 앞 + 단일 origin 정책은 Vary 자체를 안 닮), gin(happy path에만), flask(거부 시 빈 MultiDict), Starlette(무Origin 요청은 미들웨어 자체를 우회), **zipbul**(`CorsRejectResult`에 headers 없음) | |
| §7.2 ❌/◐ | | rs/cors·gin·django·actix·ASP.NET·Starlette·**zipbul**(무Origin 요청에 정적 ACAO 미방출) / koa·elysia ◐(항상 ACAO는 주지만 Vary도 항상 — elysia는 `Vary: *`) |

### §3.5 / §3.7 credentials + 와일드카드 — JS 생태계 전멸
`credentials:true` + `allowedHeaders:['*']` 설정 시:
- ❌ **JS 5종(express·fastify·hono·koa·elysia)**: 리터럴 `ACAH: *` + `ACAC: true` 방출(P9 실증) — 브라우저에서 `Authorization` 요청이 전부 network error. ACAM `*`도 동일.
- ✅ 에코 전환으로 회피: h3(P9에서 `authorization` 반사 실증)·rs/cors·Starlette·Spring·ASP.NET·actix — `*`를 wire에 안 내보내고 요청 헤더를 되쏨.
- 🔒 하드 차단: **tower-http(panic)**, **actix-cors(기동 실패)**, **zipbul(boot throw)**, flask-cors(send_wildcard 조합만 ValueError), Spring(요청 시 throw — origin 축).
- 공통 잔여 구멍: **ACEH(`Expose-Headers`) `*`+credentials는 Spring·ASP.NET·rs/cors·Starlette 모두 무방비** — 조용한 no-expose.

### §3.4 메서드 대소문자 — 강제 변환이 하드 실패를 만든다
- ❌ **gin**(`strings.ToUpper` 강제 — 소문자 커스텀 메서드 표현 불가), **flask-cors**(`.upper()` 강제 + ACRM을 조인 문자열에 substring 검사하는 §3.3 버그: `"GE" in "DELETE, GET"` 참)
- ◐ Spring(`HttpMethod.valueOf`가 `patch`→`PATCH` — 표준 6종 외 소문자 메서드만 깨짐)
- ✅ 에코 계열(rs/cors·actix·tower-http·ASP.NET AllowAnyMethod·Starlette·elysia)은 byte 보존이 구조적

### §6.1 PNA — 소수만 지원
지원: **@koa/cors(런타임 실증)** · rs/cors · Spring · django-cors-headers · Starlette · flask-cors · actix-cors(cargo feature) · **zipbul**. 미지원: express·fastify·hono·elysia·h3·gin·tower-http(→ `allow_private_network` 있음, 지원) · ASP.NET.
값 검증 엄격도: `== "true"` 정확 대조(zipbul·rs/cors·django·flask) > 존재만 확인(Starlette·actix) > 무조건 방출(gin).

### §4.1 에러 응답 헤더 보존
전원 통과(6 JS 런타임 404 실증 포함) — 예외 둘: **actix-cors는 핸들러 `Err` 경로가 `res?`로 CORS 증강을 건너뜀**(공유 의도된 에러 응답이 브라우저에서 못 읽힘), ASP.NET은 응답 시작 후 예외를 삼킴(경계 사례).

### §3.8 credentialed preflight의 ACAC — 전원 통과
14/14. 업계가 가장 잘 지키는 규칙.

---

## 3. 구현별 상세 (위반 + 27개 외 기능)

### tower-http (Rust) — 1위
- **위반**: ◐§1.5(`mirror_request` 원문 에코), ◐§3.7(`AllowCredentials::predicate`가 panic 가드 우회)
- **특기**: §7.1+§7.2를 **문서 모델 그대로** 구현한 유일한 라이브러리. 와일드카드+credentials는 `ensure_usable_cors_rules`가 layer 빌드와 `poll_ready` 양쪽에서 panic.
- **27외**: async origin predicate, `mirror_request`(origin/methods/headers), per-request `MaxAge::dynamic`, `vary()` 오버라이드, `permissive()`/`very_permissive()` 프리셋. **모든 OPTIONS를 preflight로 가로챔**(ACRM 검사 없음 — 실 OPTIONS 엔드포인트가 앱에 도달 불가).

### Spring (Java) — 2위
- **위반**: ◐§3.4(표준 6종 외 소문자 메서드 uppercase), ◐§3.7(ACEH `*`+credentials 방출 — javadoc에 명문화된 의도), ◐§7.2
- **특기**: FAIL 0. Vary 3종을 모든 검사 **앞**에서 추가. 거부는 403 `"Invalid CORS request"` — Fetch가 인정하는 명시적 표현. `*`+credentials는 요청 시 throw.
- **27외**: `allowedOriginPatterns`(호스트 와일드카드+포트 리스트, credentials 호환), config origin의 trailing-slash 트림·대소문자 무시 매칭, actual 요청의 메서드도 검증(스펙 외 방어), PNA, reactive 쌍둥이, `@CrossOrigin` per-route.

### django-cors-headers (Python) — 3위
- **위반**: ❌§7.2(항상 Vary — letter 위반이나 §7.1 통과로 캐시 오염은 없음)
- **특기**: ACRH를 아예 에코하지 않는 설계라 §1.5 원천 봉쇄. Django system check(E001–E015)로 설정을 부팅 전 검증 — origin 문법 검사(E013/E014)까지.
- **27외**: `CORS_URLS_REGEX` 경로 스코핑, `check_request_enabled` 시그널, 정규식 origin, `null`·`file://` origin 명시 지원, sync+async.

### actix-cors (Rust) — 4위
- **위반**: ❌§7.2(always-send 모델 표현 불가), ◐§1.5(any-header 에코), ◐§4.1(**핸들러 `Err` 경로가 CORS 증강 누락** — `res?` 단락), ◐§7.1(preflight 400 경로 Vary 누락)
- **특기**: 검증 우선 — ACRM/ACRH를 설정과 대조해 불일치 preflight를 400으로 거부. ACAM/ACAH/ACEH에 `*`를 **절대 방출 안 함**(`expose_any_header`도 실제 헤더 이름 목록으로 전개). 와일드카드+credentials는 서버 기동 실패.
- **27외**: `block_on_origin_mismatch`, `send_wildcard`, `disable_vary_header`(위험), PNA cargo feature, 400-거부 모델(스펙 외).

### rs/cors (Go) — 5위
- **위반**: ❌§1.5(원문 에코 + 빈 원소 16개까지 관용 설계), ❌§7.2, ◐§2.2/§3.7/§3.8(`*`+credentials 조합이 wire 도달 — README에 의도적 거부로 명문화)
- **특기**: 에코-전부 전략으로 §2.2/§3.3~§3.6이 구조적 성립. §7.1 Vary는 Go 생태계 최고(조기 return 전 무조건).
- **27외**: origin 와일드카드 패턴, `AllowOriginVaryRequestFunc`(동적 판정+Vary 동기화), zero-alloc 설계, PNA, actual 요청 메서드 검증(스펙 외), 대소문자 무시 origin 매칭(스펙 이탈 선택).

### ASP.NET Core (C#) — 6위
- **위반**: ❌§7.1(거부 origin 조기 return이 Vary보다 앞 + 단일 origin 정책 `VaryByOrigin=false` + 무Origin 스킵), ❌§7.2, ◐§3.7(ACEH `*`+credentials 무가드), ⚙§1.6(`TotalSeconds`가 **double** — `0.5` 방출 가능)
- **특기**: `AllowAnyHeader/AnyMethod`가 리터럴 `*`를 wire에 안 내보내고 에코. `*`+credentials는 빌드+평가 이중 차단.
- **27외**: named policy + endpoint metadata 체인, 와일드카드 서브도메인, IDN punycode 정규화, `OnStarting` 지연 적용. PNA 없음.

### zipbul (Bun) — 조사 시점 7위 → 수정 후 FAIL 0
- **조사 시점 위반 (2026-07-11 전부 수정됨)**: ❌§1.5(reflect 에코 — probe 실증 → 파싱된 이름 목록으로 재직렬화), ❌§7.1(`CorsRejectResult`에 `headers` 필드가 없어 거부 경로가 응답에 아무것도 못 남김 → 타입에 `headers` 추가, 거부·무Origin 응답에 `Vary: Origin` 방출), ❌§7.2(무Origin → `Reject(NoOrigin)` → 정적 `*`면 `Continue` + `ACAO: *`), ◐§1.2/§1.3(origin **함수 반환값**이 검증 우회 → 설정과 동일 기준(`'*'`/`'null'`/URL-origin 동치)으로 검증). 수정 중 추가 발견·제거: 성공 경로 Vary가 설정이 아닌 grant 값(`allowedOrigin !== '*'`)으로 판정되던 결함(origin 함수가 `'*'` 반환 시 Vary 누락 → 캐시가 와일드카드 grant를 거부 대상 origin에 재사용 가능).
- **강점**: 설정 검증은 업계 최고 수준 — origin ABNF(`new URL` 대조)·maxAge 범위(0~1e21 int)·상태코드 2xx enum·stateless RegExp 강제까지 **부팅 시점에** 잡는 건 zipbul과 django 계열뿐. §3.5(Authorization 명시 요구)·§3.7(3축 모두 처리: boot-throw/reflect/omit)은 JS 생태계에서 유일하게 전부 준수. PNA 값 정확 대조.
- **현재 상태**: FAIL 0 · PARTIAL 0 (e2e 286 pass). §1.5는 11/14가, §7.x는 과반이 실패하는 업계 공통 결함 축이었고, 수정으로 **14개 중 유일한 §1.5+§7.1+§7.2+§3.5+§3.7 동시 통과 구현**이 됐다.

### cors (Express·NestJS) — 10위
- **위반**: ❌§1.5·§3.5·§3.7(P3/P8/P9 실증 — `ACAH: *`+`ACAC: true` 그대로 방출), ◐§2.2(`*`+credentials 무가드), ⚙§1.6(`maxAge: -1.5` → wire에 `-1.5` 실증)
- **특기**: §7.1·§7.2 둘 다 통과(P1/P4/P7) — 캐시 축은 JS에서 가장 정확. 거부 origin 응답에도 `ACAC: true`를 남기는 군더더기.
- **27외**: origin async 함수, `preflightContinue`, `optionsSuccessStatus`. NestJS `enableCors`가 이 패키지를 그대로 사용 — 여기의 결함은 NestJS 전체에 상속됨.

### @fastify/cors — 10위
- express와 동일 프로파일(전 프로브 동일 결과). **27외**: `strictPreflight`(기본 true — Origin/ACRM 없는 preflight를 400 거부, 스펙 외), `hook` 옵션(등록 라이프사이클 선택), 기본 메서드가 `GET,HEAD,POST`뿐이라 PUT preflight가 기본 설정에서 거부됨(주의).

### hono — 10위
- express와 동일 축 위반. `,,` 에코 시 공백만 트림하고 빈 원소는 유지(`X-Foo,,x-bar` 실증). preflight에 `Vary: ACRH` 미부착.
- **27외**: origin 함수(c 컨텍스트), 프레임워크 내장이라 별도 설치 불요.

### @koa/cors — 13위
- express 축 + ◐§7.2(정적 `*`에도 `Vary: Origin` 상시 — 캐시 효율만 손실).
- **27외**: **PNA 지원(실증)**, `secureContext`(COOP/COEP 방출 — CORS 밖 헤더), `keepHeadersOnError`(§4.1 보강).

### @elysiajs/cors — 13위
- express 축 + ◐§7.2. 특이: 정적 설정에서 **`Vary: *`** 방출(캐시 전멸). **기본값이 모든 origin 반사**(P2에서 `evil.com` 에코 실증) — §8.1 관점에서 가장 위험한 기본값.

### h3 — 9위
- ❌§1.5·§7.1(성공 경로만 Vary — P4/P7 실증)·§3.7(ACAM `*`+credentials). §3.5는 통과(`allowHeaders:'*'`가 에코로 동작 — P9 실증).
- **27외**: `preflight.statusCode` 옵션. Nuxt/Nitro 전체가 이 구현에 의존.

### gin-contrib/cors — 15위
- ❌§3.4(강제 대문자화 — 복구 불가), ❌§7.1(거부·무Origin·same-host 전부 Vary 없음 + AllowAllOrigins 모드는 Vary 자체가 없음), ❌§7.2, ◐§2.1(**스킴 이중 검사 same-host 단락** — `http://`와 `https://` 둘 다 자기 host로 보고 명시 허용된 교차 스킴 origin에 헤더 미방출), ◐§2.2/§3.8
- **27외**: 스킴 allowlist(browser-extension/ws/file/custom), 정규식 origin(**요청마다 재컴파일** — 성능·panic 위험), 403 하드 차단, 모든 OPTIONS 하이재킹.

### flask-cors — 15위
- ❌§1.5(정규식 필터가 빈 원소 매치), ❌§3.4(강제 대문자), ❌§7.1(거부 시 헤더 전무 + 단일 origin 설정은 성공 응답에도 Vary 없음), ◐§3.3(**substring 버그**: ACRM을 조인 문자열에 `in` 검사), ◐§1.6·§7.2
- **27외**: per-path `resources` 스코핑, 정규식 origin·헤더, `always_send`(§7.2 모델에 가장 근접한 옵션), `@cross_origin` 데코레이터, PNA 거부 시 `false` 명시 방출(특이).

---

## 4. 27개 규칙 밖 기능 인벤토리 (업계 종합)

zipbul에 없는 것 중 채택 검토 가치가 있는 축:

| 기능 | 보유 구현 | 비고 |
|:--|:--|:--|
| **origin 와일드카드 패턴** (`https://*.example.com`) | rs/cors, gin, Spring(포트 리스트까지), ASP.NET(서브도메인), flask·django(정규식) | zipbul은 RegExp로 표현 가능 — 패턴 문법은 불필요할 수 있음 |
| **동적 판정+Vary 동기화** | rs/cors `AllowOriginVaryRequestFunc` | origin 함수가 Origin 외 헤더를 참조할 때 Vary를 함께 선언 — §7.1의 일반화 |
| **per-route/named policy** | Spring, ASP.NET, flask(`resources`), django(`CORS_URLS_REGEX`) | 프레임워크 통합 축 |
| **async origin predicate** | tower-http, express(콜백), elysia | zipbul 이미 보유(OriginFn async) |
| **preflight 통과/상태 옵션** | express·fastify(`preflightContinue`/`optionsSuccessStatus`), h3, gin | zipbul 이미 보유 |
| **strictPreflight**(비정상 preflight 400) | @fastify/cors, actix(구조적) | 스펙 외 — 채택 시 STANDARDS 밖임을 명시해야 |
| **PNA-ID/Name**(§6.2) | **전무** — 14개 중 0 | zipbul이 구현하면 업계 최초 |
| **expose_any_header**(실헤더 전개) | actix-cors 유일 | credentials-safe한 "모두 노출" |
| **COOP/COEP 동시 방출** | @koa/cors `secureContext` | CORS 밖 — helmet 소관이 맞음 |
| **설정 시점 origin ABNF 검증** | zipbul, django(E013/E014), gin(스킴만), ASP.NET(정규화) | zipbul이 가장 엄격 |

---

## 5. 결론

1. **27개 규칙을 전부 통과하는 구현은 없다.** 최상위 tower-http·Spring도 PARTIAL 2~3개를 안고 있다.
2. **§1.5(빈 원소 에코)는 11/14가 위반하는 업계 표준 결함**이다. 에코 자체를 피하거나(설정 조인) 분해-재조립하는 4개만 통과했다.
3. **캐시 규칙(§7.1·§7.2)이 최대 변별 축**이다. 둘 다 지키는 것은 tower-http뿐이고, 이 축의 실패는 공유 캐시 뒤에서 조용한 CORS 장애(§7.1) 또는 캐시 오염(§7.2)으로 나타난다.
4. **JS 생태계는 credentials+와일드카드에 전멸**(리터럴 `*` 방출)인 반면, 시스템 언어 계열은 panic/기동실패/에코 전환으로 방어한다. 주간 6,200만 다운로드의 `cors`(Express·NestJS)가 이 축에서 실패한다는 것은 생태계 규모의 문제다.
5. **zipbul의 조사 시점 FAIL 3개는 전부 업계 공통 결함 축**이었고(§7.1·§7.2 = `CorsRejectResult` 타입 + `NoOrigin` 조기 거부, §1.5 = reflect 원문 에코, §1.2/§1.3 = origin 함수 미검증), **2026-07-11 TDD로 전부 수정 완료**되어 현재 **14개 구현 중 유일한 전 축(§1.5+§7.1+§7.2+§3.5+§3.7) 동시 통과 구현**이다 — 조사 시점 기준 그 조합을 만족하는 다른 구현은 존재하지 않는다.
