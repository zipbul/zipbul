# @zipbul/conditional-request — 구현 계획 (v3, 프레임워크 전수분석 반영)

**상태**: Phase 0 완료(스켈레톤). STANDARDS.md는 2회차 3엔진 적대리뷰로 확정(정본). 이 v3는 **STANDARDS 확정 후** 프레임워크(`@zipbul/result`·http-adapter·core·기존 7개 미들웨어)를 전수분석하여, 구현이 **어떤 enum·어떤 단락 메커니즘·어떤 오류 관례**를 따라야 하는지 사실 근거(file:line)로 못박은 계획이다. v2 대비 바뀐 핵심: (1) 코드는 아직 0줄 — 계획이 먼저다, (2) string-literal 유니온 금지·프레임워크 enum 강제, (3) 412/304 단락은 프레임워크 실측 메커니즘(`Err` 반환 vs `send()`)에 정확히 매핑, (4) 해피/네거티브/엣지/예외 테스트 매트릭스 포함.

---

## 0. 확정된 프레임워크 사실 (전수분석 — 모든 주장 file:line 근거)

### 0.1 `@zipbul/result` 공개 표면 (packages/libs/result)
- 익스포트 **전부**: `err`, `isErr`, `safe`, `getMarkerKey`/`setMarkerKey`, 타입 `Err`·`Result`·`ResultAsync` (`index.ts:1-5`). **`ok`·`isOk`·콤비네이터(map/andThen/unwrap/match) 없음** (README.md:341 "no `.map()` or `.flatMap()`").
- `Err<E> = { data: E }` (`types.ts:17-19`) — 필드는 **`.data` 하나**, `.error` 없음.
- `Result<T,E> = T | Err<E>` (`types.ts:38`) — 성공은 **맨몸 `T`**. `Ok<T>` 타입 없음.
- `ResultAsync<T,E> = Promise<Result<T,E>>` (`types.ts:58`).
- 생성: `err(x)` → frozen `{[marker]:true, data:x}` (`err.ts:32-39`), never throws. 읽기: `isErr(r)`(`is-err.ts:30-43`) 후 `r.data`.
- `safe(fn, mapErr?)` — throw를 `err`로 브리지 (`safe.ts:76-92`).

### 0.2 throw vs Err 철학 (core adapter.ts)
- **예상 가능/클라이언트 귀책 실패 → `Err` 반환** (값 채널로 4xx 단락). PipelineStepFn: "Returns Err to short-circuit, undefined/void to continue" (`adapter.ts:74-80`).
- **`throw`는** (a) 예외필터 라우팅(검증 기본 재throw `adapter.ts:382-384`), (b) 프로그래머/설정/불변식·부트 오류 전용. 미처리 throw → 500 "Unhandled error" (`adapter.ts:474-476`).

### 0.3 미들웨어 관례 (7개 패키지 실측)
1. **옵션/부트 검증 실패 → 패키지 전용 `XError extends Error` throw** (never 반환-Result to caller). 근거: cors `cors.ts:95/115/121`, cookie `cookie-options.ts:129`, compression `middleware.ts:36`, query-parser `query-parser.ts:34`, multipart `multipart.ts:32`, rate-limiter `rate-limiter.ts:48`, helmet `helmet.ts:128`. 하위규칙: `validateXOptions()`는 내부적으로 `err(...)` 반환, 팩토리/`create`가 `if(isErr) throw new XError(v.data)`로 변환. baker "불가능" 상태(이슈셋 무이슈 등)는 `throw new Error('internal: ...')`.
2. **`err`/`isErr`/`Result`는 회복 가능·요청별·데이터 의존 실패 전용** (cookie per-cookie, query-parser `parseResult`, multipart 저수준 파서).
3. **`httpError()`(=`Err<ErrorResponseData>`)로 4xx 단락 응답 반환** — 프로덕션 유일 예 query-parser `middleware.ts:68` (`HttpStatus.BadRequest`). 주석: 클라이언트 malformed는 **반환**(throw 아님 — throw는 "attacker-triggerable 500").
4. **`response.send()`는 OnRequest의 cors preflight 단 1곳** (`cors/middleware.ts:67`). BeforeResponse 미들웨어(cookie·compression)는 **응답 변형만**, send/halt 없음.
5. **판별 유니온은 enum 판별자** (`CorsAction`, `RateLimitResult.action`) — string literal 금지.

### 0.4 파이프라인 단락 메커니즘 (실측)
- **가드/미들웨어가 `Err` 반환 → 핸들러 스킵**: `runGuards`/`runHttpMiddlewares`가 첫 `Err` 반환(`adapter.ts:415-428`, `http-adapter.ts:415-425`) → `runPipeline` pre-루프 `isErr`에서 break(`adapter.ts:308-315`) → `if(result===undefined) handler`가 안 돎(`adapter.ts:317-319`) → `WriteResponse`가 `writeErrorResponse` 렌더(`http-adapter.ts:290-291`).
- **`send()`는 커밋 플래그**(`_committed`)만 세움(`http-response.ts:53-55`). **OnRequest**에서는 `runOnRequest`가 라우팅/핸들러 전에 `isSent()` 검사(`http-adapter.ts:159,176`)라 전체 단락. **BeforeHandle**에서는 pre-루프가 `isErr`에서만 break하므로 send()해도 **핸들러가 그대로 실행**되고 결과만 `WriteResponse`의 `isSent()`에서 폐기(`http-adapter.ts:288`).
- **"비-에러 상태로 핸들러 중단"하는 1급 수단은 없음** (`send()` 커밋 / `Err` 반환 둘뿐 — http-response.ts 전수 확인).
- 예외필터: throw → `executeExceptionFilterChain` → `Err` 변환(`adapter.ts:440-460`). throw 가능한 `HttpError` 클래스는 **없음** — `httpError()`는 팩토리.

### 0.5 HTTP enum 실측 (packages/adapters/http/src/enums)
- **HttpStatus**: `NotModified=304`·`PreconditionFailed=412`·`PartialContent=206`·`PreconditionRequired=428`·`RangeNotSatisfiable=416` 모두 존재(`http-status.ts`). **추가 불필요.**
- **HttpMethod**: Get/Head/Connect/Options/Trace/Put/Post/Delete/Patch 완비(`http-method.ts`). **추가 불필요.**
- **HttpHeader**(`http-header.ts`): 보유 = `ETag`·`Vary`·`CacheControl`·`Expires`·`Location`·`ContentType`·`ContentLength`·`TransferEncoding`·`ContentEncoding`·`AcceptEncoding`. **린 v1 누락(추가 필요) 7개**:
  - 요청 조건부: `IfMatch='if-match'`, `IfNoneMatch='if-none-match'`, `IfModifiedSince='if-modified-since'`, `IfUnmodifiedSince='if-unmodified-since'`
  - 검증자/304: `LastModified='last-modified'`, `ContentLocation='content-location'`, `Date='date'`
  - (v1 제외 — If-Range defer와 함께) `IfRange`·`Range`·`AcceptRanges`는 range 소비자 생길 때 추가.
- **req/res API**: `req.headers.get(HttpHeader.X)`(표준 `Headers`), `req.method:HttpMethod`; `res.setStatus(HttpStatus)`, `res.setHeader/getHeader/removeHeader/appendHeader`(name 소문자 정규화 후 `HttpHeader.*` 비교), `res.send()/isSent()`. **`build()`가 `_status===NotModified`면 §15.4.5대로 body만 제거하고 Content-Type/Encoding/Length는 유지**(`http-response.ts:469-487`) — 304 body strip은 어댑터가 이미 처리.

---

## 1. 아키텍처 — 린(lean) v1 (사실 위에 설계, 과함 제거)

**v1 코어 = 평가전용(evaluate-only).** ETag 자동생성·If-Range·§7.4는 v1 제외(근거 §1.6). 앱/핸들러가 ETag·Last-Modified를 세팅하고(읽기) 또는 `getValidators`로 현재 검증자를 제공하면(쓰기), 이 미들웨어가 §13.2.2로 평가해 304/412를 낸다. express `fresh`·koa `conditional-get`과 같은 평가전용 모델.

### 1.1 순수 평가 엔진 (`src/evaluate.ts` — 프레임워크·phase 무관)
§13.2.2의 단일 진실. 입력 전부를 받는 순수 함수. **판별 유니온은 enum으로**(cors `CorsAction` 관례), **3변형**:

```
enum PreconditionAction { Continue, RespondNotModified, RespondPreconditionFailed }
```
- 결과 = `action: PreconditionAction.X` (페이로드 없음 — v1은 If-Range `ignoreRange`·§7.4 `alreadyApplied` 제외). `Continue`는 게이트-무시(§3.2/§3.3)와 조건-통과(§4.1 step6)를 함께 의미(미들웨어 동작 동일).
- 평가 대상: **If-Match·If-None-Match·If-Unmodified-Since·If-Modified-Since** (If-Range 제외 — §1.6).
- strong/weak 비교(`src/etag.ts` — §8.8.3 ABNF 파싱 + §8.8.3.2 비교), HTTP-date 파싱(`src/http-date.ts` — §5.6.7 3개 포맷)을 내장. `*`·다중태그·잘못된 날짜(무시)·§4.1 skip 그래프 전부 여기.
- **먼저 RFC 평가 테이블을 유닛 테스트**(3장 매트릭스) — 미들웨어 글루 전.

### 1.2 검증자 공급 계약
- **쓰기(412)**: `getValidators(ctx) → { exists: boolean; etag?: EntityTag; lastModified?: number }` — 앱/라우트가 **상태 변경 전** 현재 selected representation 검증자 제공(옵티미스틱 락). 없으면 write 사전조건 평가 불가 → pass-through(428은 범위 밖).
- **읽기(304)**: 핸들러가 응답에 세팅한 `ETag`/`Last-Modified` 헤더를 BeforeResponse에서 읽어 검증자로 사용. **자동생성 안 함**(§1.6).

### 1.3 미들웨어 배선 — 이원(dual) phase, 프레임워크 메커니즘에 정확 매핑
프레임워크 제약(§0.4): **핸들러를 확실히 막는 유일 수단은 `Err` 반환**. 쓰기/읽기를 phase로 분리하되 §13.2.2 순서는 phase 순서로 보존:

- **BeforeHandle** (write 사전조건 — 반드시 핸들러 전 차단):
  - `getValidators` 제공 시 If-Match·If-Unmodified-Since·(비-GET/HEAD)If-None-Match 평가.
  - **412** → **`return httpError(HttpStatus.PreconditionFailed)`** → 핸들러 스킵 → §5.1.2/§5.2.2/§5.4.4 "MUST NOT perform" 성립.
  - `getValidators` 없으면 write 사전조건 pass-through.
- **BeforeResponse** (읽기 304):
  - GET/HEAD·버퍼된 200 응답에서 핸들러가 세팅한 `ETag`/`Last-Modified`를 읽어 If-None-Match/If-Modified-Since 평가 → 일치 시 `setStatus(HttpStatus.NotModified)`로 200→304 다운그레이드(어댑터 `build()`가 body strip). 핸들러 스킵 불필요(이미 실행·GET/HEAD 안전), §6.2/§6.4 헤더 정밀 제어. 스트림·`text/event-stream`·커밋됨·native Response·ETag/Last-Modified 부재 시 skip.
- **ordering 보존 근거**: §4.1에서 GET의 If-None-Match(step3)를 게이트하는 유일 선행은 If-Match(step1). If-Match false면 BeforeHandle 412로 끝(BeforeResponse 미도달); true면 핸들러 실행 후 BeforeResponse가 If-None-Match/If-Modified-Since를 §4.2 상호배제까지 한 phase에서 처리 → 단일 순서 불변식 유지.

### 1.6 v1 제외 (과함 — 근거 명시, STANDARDS 정본엔 유지)
- **If-Range(§5.5)** — Range/206/If-Range는 **미들웨어가 아니라 표현 바이트를 소유·seek하는 서빙 계층의 일**이다(검증: ASP.NET `StaticFileMiddleware`+`FileStreamResult`, koa-send/static, express send, @fastify/static — **어떤 주요 프레임워크도 range를 독립 미들웨어로 두지 않음**). 파이프라인 미들웨어는 스트림/파일 바이트를 소유하지 않아 byte-range를 슬라이스·서빙할 수 없다. → `@zipbul/range` 미들웨어를 가정하지 않는다. If-Range 평가는 **바이트 서빙 기능(정적 파일/파일 스트림 응답)** 이 생길 때 그 계층에서 함께 다룬다. v1 conditional-request는 If-Range 미평가.
- **§7.4 already-applied → 2xx (MAY)** — MAY + 앱 지식 요구. v1은 412만; 2xx 전환은 앱이 자체 구현.
- **ETag 자동생성(§1.1 SHOULD)** — express `etag`/`fresh` 분리처럼 별개 관심사. v1은 평가전용(앱이 ETag 세팅). body해시·Vary·압축순서 복잡성 제거.
- **§3.2 would-be-status 게이트** — BeforeHandle **전** 라우팅·가드·검증이 비-2xx를 이미 Err 단락. phase 배치로 구조적 충족 → 입력 노출 불필요.

### 1.4 옵션 & 오류 (baker가 옵션 검증 전담)
- **옵션 검증은 baker 책임.** `@Recipe`/`@Field` 규칙이 SHAPE/TYPE를 전부 검증(`etag ∈ {'strong','weak',false}`, `getValidators`가 함수인지 등). 스켈레톤 `options.ts`의 `resolveConditionalRequestOptions()`가 `validateSync` + `isBakerIssueSet`로 이미 처리.
- **"부트 검증 실패"의 실체 = 소비자가 잘못된 타입/값을 넘긴 것뿐.** 팩토리 `conditionalRequestMiddleware()`는 baker 이슈셋을 **fail-fast throw**로 surface(스켈레톤 현 방식 유지 — `if(isErr(resolved)) throw resolved.data`). 다른 6개 미들웨어와 동일한 부트-throw 관례.
- **cors식 `XError + reason enum`은 도입 안 함(과함).** cors는 baker로 표현 못 하는 cross-field 의미 규칙(`credentials:true`+`origin:'*'` 등)이 여럿이라 필요했지만, conditional-request 옵션은 대체로 독립적이라 cross-field 조합 오류가 없다. **baker로 못 잡는 진짜 의미 검증이 실제로 나오면** 그때만 명명 오류/reason을 추가.
- 옵션(초안): `etag: 'strong'|'weak'|false`(응답 ETag 생성 정책, 기본 false — opt-in), `weakEtag`, `getValidators?` 콜백, `alreadySucceeded?` 훅. **모든 상태/헤더/메서드 리터럴은 `HttpStatus`·`HttpHeader`·`HttpMethod` enum 사용**, `PreconditionAction` enum으로 판별.

### 1.5 프레임워크 선행 변경 (http-adapter)
- `packages/adapters/http/src/enums/http-header.ts`에 §0.5의 **9개(+선택1) 헤더 enum 값 추가**. http-adapter CLAUDE.md상 헤더 어휘는 어댑터 소관 — 미들웨어가 raw string 리터럴을 쓰지 않도록 enum에 정본화. (별도 커밋/조율.)

---

## 2. 범위 경계 (STANDARDS §8과 일치)
- **206 본문 생성·Range 파싱(§14)** = `@zipbul/range`(미래) 소관. 이 미들웨어는 §5.5 If-Range 평가·무시(step5 순서)만 담당, "Range 적용/무시" 신호 전달(`PreconditionAction.Perform.ignoreRange`).
- 캐시 저장·클라이언트 재검증 발신(RFC 9111) = 범위 밖. wire framing·상태줄 = http-adapter.

---

## 3. 테스트 매트릭스 (해피 · 네거티브 · 엣지 · 예외) — TDD, 유닛 우선

### 3.1 `etag.ts` — 파싱·비교 (§8.8.3 / §8.8.3.2)
| 구분 | 케이스 |
|--|--|
| 해피 | `"abc"`→strong; `W/"abc"`→weak; `""`→빈 opaque; 리스트 `"a","b","c"`; `*` |
| 네거티브 | DQUOTE 없음(`abc`); 미종결(`"abc`); 리스트에 malformed 멤버 |
| 엣지 | opaque 내 콤마 `"a,b"`(콤마 split 금지); 소문자 `w/`(weak 아님→무효); opaque 내 obs-text(0x80-FF) 허용; 닫는 DQUOTE 뒤 잔여 바이트 |
| 예외 | CTL(0x01) in opaque→무효; 빈 문자열 리스트→undefined |
| 비교표 | §8.8.3.2 Table3: `W/"1"`↔`W/"1"`(strong✗/weak✓), `W/"1"`↔`"1"`(strong✗/weak✓), `"1"`↔`"1"`(둘✓), `"1"`↔`"2"`(둘✗) |

### 3.2 `http-date.ts` — §5.6.7 3포맷
| 구분 | 케이스 |
|--|--|
| 해피 | IMF-fixdate·rfc850·asctime 각 파싱→동일 epoch(초 정밀) |
| 네거티브 | 형식 불일치·비-GMT·깨진 토큰→undefined |
| 엣지 | asctime 한 자리 일(`Nov  6`); rfc850 2자리 연도 pivot; 윤년 2/29 유효 |
| 예외 | 2/30·13월·25시·60분→undefined(round-trip 검증); 빈 문자열 |

### 3.3 `evaluate.ts` — §13.2.2 평가 테이블 (핵심)
게이트(§3):
- §3.3: CONNECT/OPTIONS/TRACE → `Continue`(사전조건 무시). (§3.2 would-be-status 게이트는 phase 배치로 구조적 충족 — §1.6.)
If-Match(§5.1 / step1):
- 해피: `*`+exists→perform; 태그 strong 매치→perform
- 네거티브: `*`+!exists→412; 매치 없음→412; weak로 생성된 현재 ETag는 strong 대조 실패→412
- 엣지: 다중 태그 중 하나 매치
- 예외: malformed If-Match→매치 없음(412 방향, fail-closed)
If-None-Match(§5.2 / step3):
- 해피(GET): `*`+exists→304; 태그 weak 매치→304; **매치 없음→perform(그 외 true)**
- 네거티브(비-GET, 예: `PUT If-None-Match:*` create-guard): exists→412
- 엣지: If-None-Match present면 If-Modified-Since 무시(§4.2); `*`+!exists→perform(create 허용)
- 예외: malformed→true(가드가 요청 차단하지 않음)
If-Modified-Since(§5.3 / step4):
- 해피(GET): last-mod ≤ date → 304; last-mod > date → perform
- 네거티브: 비-GET/HEAD·다중 member·무효 date·수정일 미상 → 무시
- 엣지: If-None-Match 동시 present → IMS 무시(§4.2); origin clock 해석
If-Unmodified-Since(§5.4 / step2):
- 해피: last-mod ≤ date → perform; last-mod > date → 412
- **비대칭 검증**: IMS(≤→false) vs IUS(≤→true) 반대 방향 동시 테스트
- 네거티브: If-Match present면 IUS 무시(§4.3); 무효 date·수정일 미상 → 무시
(If-Range §5.5는 v1 제외 — §1.6. range 소비자 생길 때 테스트 추가.)
우선순위/상호작용(§4):
- If-Match+If-None-Match on GET: If-Match false→412(INM 미평가); If-Match true→INM 평가
- 6단계 순서 각 분기 skip 그래프 스냅샷

### 3.4 미들웨어 배선 (`conditional-request.ts`)
| 구분 | 케이스 |
|--|--|
| 해피 | BeforeHandle 412→`httpError(PreconditionFailed)` 반환(핸들러 안 돎 검증: 다음 스텝 미실행); BeforeResponse GET 304 다운그레이드(body strip, §6.2 헤더) |
| 네거티브 | getValidators 없음→write 사전조건 pass-through; 비버퍼/스트림 응답→304 skip |
| 엣지 | 304에 Content-Location·Date·ETag·Vary·Cache-Control·Expires 존재(§6.2), §6.4 초과 metadata 없음; 응답에 ETag/Last-Modified 없으면 304 미발생 |
| 예외 | 옵션 타입 오류→baker 이슈셋→팩토리 fail-fast throw(부트); getValidators 콜백 throw→`safe`로 감싸 처리 or 정의된 정책 |

### 3.5 옵션 (`options.ts`)
해피(기본/명시 값 resolve) · 네거티브(잘못된 타입→baker 이슈셋→`err`→팩토리 throw) · 예외(baker 불가능 상태[이슈셋 무이슈]→plain `Error('internal: ...')`). (옵션 표면은 린 v1 최소 — etag 자동생성 옵션 없음.)

### 3.6 통합(e2e, http-adapter test-fixtures 활용)
- 실제 파이프라인에서 PUT+If-Match 불일치 → 412 & **핸들러 미실행(상태 불변)** 검증 (§5.1.2 회귀 방지 — v1 아키텍처 버그).
- GET+If-None-Match 매치 → 304 무본문 + §6.2 헤더.

---

## 4. 업계 대조 (Phase 후반)
express `fresh`+`etag`, koa `conditional-get`+`etag`, `@fastify/etag`, Spring `ShallowEtagHeaderFilter`, ASP.NET Core. **변별축**: 대부분 conditional GET(304)만 구현하고 write 사전조건(412)·§13.2.2 순서·strong/weak 구분을 무시. 그 불완전성을 복제하지 않음.

---

## 5. 시퀀스
1. **(선행)** http-adapter HttpHeader enum에 7개 헤더 추가(§0.5) + 그 패키지 테스트/빌드.
2. `etag.ts`+`http-date.ts` (TDD, 3.1·3.2) → green.
3. `evaluate.ts` 순수 엔진 (TDD, 3.3 전체 매트릭스) → green.
4. 미들웨어 배선 BeforeHandle(412)/BeforeResponse(304) (TDD, 3.4) + 옵션 (3.5).
5. e2e (3.6).
6. `zb build middleware` 빌드 통과 확인(kind 필수) → README en/ko(평가전용·순서·검증자 계약·enum) → 적대 리뷰 → PR.

---

## 6. 미결정 (사용자 판단 필요 — 최소화)
- **Q1 (HttpHeader enum 추가 방식)**: 7개 헤더를 http-adapter 별도 선행 커밋 vs 이 작업에 포함. **권고: 선행 별도 커밋**(어댑터 어휘 정본).
- **Q2 (평가전용 v1 승인)**: ETag 자동생성·If-Range·§7.4를 v1에서 빼는 것(§1.6) 확정 여부. **권고: 확정** — 소비자 부재/MAY/분리가능. 필요 시 각각 후속.

(이전 Q1[304 emission]·Q2[ETag 기본값]은 린 v1에서 해소: 304=BeforeResponse 다운그레이드, ETag 자동생성=v1 제외.)

---

## 부록 A — Phase 1 (프레임워크가 zb-build 미들웨어 강제) : 분리, 임계경로 제외
manifest 존재 ≠ 유효 미들웨어(zero-augment는 manifest 없어도 정상). conditional-request는 augments=0이라 직교. 별도 프레임워크 제안으로. (v2 부록 유지.)
