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

## 6. 검증 과정 요약

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
| 16차 | **§1 "기능 범위 밖" 8건 삼자리뷰 + 일괄 closure**: enum wire 값 16개 snake_case → kebab-case (CorsAction/CorsRejectionReason/CorsErrorReason). `CorsError` `Object.freeze(this)` → per-property `defineProperty` (reason/message/cause non-writable + 인스턴스 extensible — 사용자 subclass 자유). baker `seal()` 을 `Cors.create` 의 lazy first-call 로 이동 (라이브러리가 global baker config 점유 X). **D-NEW-11** `data.cause !== undefined` → `'cause' in data` 가드 변경으로 ECMAScript Error Cause 시그널 정합. **D-NEW-16** `index.ts` 의 `CorsErrorData` export 제거 (`@internal` 유지 — 사용자 facing 은 `instanceof CorsError` + reason/message/cause read 만). D-NEW-12 (15차 `Object.freeze` cover 재확인 CLOSED), D-NEW-10/14/17/18 EXCLUDED (type 우회 사용자 책임 또는 HTML Standard 한계 또는 self-harm). D-NEW-15 ENHANCE (`toJSON()` 별개 후보). CorsError per-property freeze + subclass extensibility spec 5건 신규 (interfaces.spec.ts) | **신규 0건**, **3건 CLOSED** (D-NEW-11/12/16), **4건 EXCLUDED** (D-NEW-10/14/17/18), **BREAKING 2건** (enum wire kebab + CorsError ABI 변경) |
| 17차 | follow-up: CORS_E2E.md 의 stale snake_case reason 6곳 → kebab-case sweep. interfaces.spec.ts 에 CorsError per-property freeze + subclass extensibility 검증 5건 추가 | **신규 0건**, 누락 spec 5건 보강 |
| 18차 | **정책 재정립 + 방어 코드 일괄 제거 (삼자리뷰 전수조사)**: 사용자 토론 결정 — "`CorsOptions` boot validation 만 cors 책임, 그 외 모든 방어/검증/freeze/clone 은 사용자 책임". 제거: (1) `cors.ts` 의 array clone 4종 + `Object.freeze(resolved)` + `CORS_DEFAULT_METHODS` `Object.freeze` + `CorsError` per-property `defineProperty`, (2) `cors.ts` `resolveOriginResult` 의 wildcard 분기 + `isOrigin(result)` runtime 검증, (3) `cors.ts` `filterValidHeaderTokens` + 사용처, (4) `CorsErrorReason.InvalidOriginReturn` enum (dead). spec 33건 동반 삭제 (closure 3 / immutability 5 / InvalidOriginReturn 15 / wildcard runtime throw 3 / ACAH filter 3 + 1 / e2e 3). 정책 노트 정정 + D-NEW-2/D-NEW-12 EXCLUDED 재분류 + Contract 카테고리 0건 표기. baker `safe()` wrapper / methods 정규화 / OriginOptions union 디스패치는 유지 (사양 검증/wire 정확성 영역, 방어 코드 아님) | **신규 0건**, **D-NEW-2/D-NEW-12 EXCLUDED 재분류**, **BREAKING 4건** (OriginFn `'*'` + credentials runtime throw 폐지, OriginFn 반환 사양 부합 검증 폐지, ACAH echo verbatim, 사용자 array reference 보존) |

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
