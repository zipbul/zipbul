# HANDOFF — @zipbul/conditional-request (2026-07-12)

## 현재 상태: 계획 단계. 코드 0줄(스켈레톤 제외). 확정된 것 없음.

**워크트리**: `.claude/worktrees/conditional-request` (브랜치 chore/monorepo-consolidation에서 파생, 패키지 전체가 미추적 — 커밋 0개).

---

## 1. 확정된 사실

### 미들웨어 범위 (사용자 압박으로 확정, 근거 완비)
**conditional-request = RFC 9110 §13 사전조건 평가(4헤더) → 304/412. 그게 전부.**
- IN: If-Match·If-None-Match·If-Modified-Since·If-Unmodified-Since 평가(§13.2.2 우선순위, §8.8.3.2 strong/weak 비교, HTTP-date 파싱), 읽기→304, 쓰기→412.
- OUT: **ETag/Last-Modified 생성**(§8.8 — 앱/핸들러 책임, koa-etag처럼 별개 관심사), **If-Range/Range/206**(바이트 서빙 계층의 일 — 어떤 주요 프레임워크도 range를 독립 미들웨어로 두지 않음: ASP.NET StaticFileMiddleware/FileStreamResult, koa-send, express send, @fastify/static — 웹 검증 완료), 캐시 저장(RFC 9111).
- `@zipbul/range` 미들웨어는 **계획하지 않는다** (미들웨어는 표현 바이트를 소유하지 못해 range 서빙 불가).

### STANDARDS.md (같은 디렉토리)
- RFC 9110 §8.8/§13/§15.4.5/§15.5.13 역방향 대조로 작성, **2회차 3엔진(claude·codex·grok) 적대리뷰 + 10건 수정 반영 완료** (§1.5 완화, §1.7 게이트, §1.10 trailer MAY, §5.2.1 "그 외 true", §5.3.1 field-member, §5.5.3/5.5.4 분리, §5.6.1 strong-LM 술어, §5.6.2·§7.4 인용, §6.3 무표기).
- **미해결**: 반영본 자체는 재검증 안 됨 + **범위 불일치** — 문서가 생성 규칙(§1)·If-Range(§2.3·§5.5·§5.6.1)까지 포함해 확정된 v1 범위(평가전용)보다 넓다. §8.8.3 ABNF·§8.8.3.2 비교표는 유지 필요(받은 ETag 파싱·비교에 필수).
- 코퍼스: `/tmp/claude-1000/-home-revil-projects-zipbul-zipbul/04c93b6a-aaf8-4e31-ad66-9a15f2df7130/scratchpad/cr-corpus.txt` (RFC 9110 원문 976줄, tmp라 소실 가능 — 재생성: RFC 9110에서 §8.8/§13/§15.4.5/§15.5.13 발췌).

### 프레임워크 전수분석 (3 에이전트, file:line 근거 — PLAN.md §0에 요약 기록됨)
- **result**: 표면 전체 = `err`/`isErr`/`safe`/타입. `ok`·콤비네이터 없음. `Err<E>={data:E}`, `Result<T,E>=T|Err<E>`.
- **단락 메커니즘**: 핸들러를 확실히 막는 유일 수단 = 미들웨어/가드가 **`Err` 반환**(runPipeline pre-루프 isErr break → 핸들러 스킵, core adapter.ts:308-319). `send()`는 커밋 플래그일 뿐 — OnRequest에서만 전체 단락(http-adapter.ts:159,176), **BeforeHandle에서는 핸들러가 그대로 실행됨**(cors preflight의 send()는 OnRequest라서 동작).
- **관례**: 부트 옵션 실패=baker가 검증, 팩토리 fail-fast throw(커스텀 XError+reason enum은 cross-field 규칙 있는 cors만 — 우리는 불필요, 사용자 확인됨). 요청시 클라이언트 실패=`httpError(HttpStatus.X)` 반환(유일 프로덕션 예: query-parser middleware.ts:68). 판별 유니온=**enum 판별자**(CorsAction) — string literal 금지.
- **enum**: HttpStatus(304/412/206/428 완비)·HttpMethod 완비. **HttpHeader에 7개 누락**: IfMatch/IfNoneMatch/IfModifiedSince/IfUnmodifiedSince/LastModified/ContentLocation/Date (IfRange·Range·AcceptRanges는 v1 제외라 defer).
- **304 body strip은 어댑터 내장**: HttpResponse.build()가 status===NotModified면 body 제거, Content-Type 등 유지(http-response.ts:469-487).

### 아키텍처 (PLAN.md v3 — 린 v1)
- 순수 엔진 `evaluate.ts`: enum `PreconditionAction { Continue, RespondNotModified, RespondPreconditionFailed }` 3변형.
- **BeforeHandle**(쓰기 412): `getValidators(ctx)→{exists,etag?,lastModified?}` 계약(앱이 상태변경 전 현재 검증자 제공, 옵티미스틱 락). 412 = `return httpError(HttpStatus.PreconditionFailed)` — §5.1.2 "MUST NOT perform" 성립. getValidators 없으면 pass-through.
- **BeforeResponse**(읽기 304): 핸들러가 세팅한 ETag/Last-Modified 읽어 평가 → `setStatus(NotModified)` 다운그레이드. 스트림/native/커밋됨 skip.
- ordering: If-Match false→BeforeHandle 412로 종결이라 §13.2.2 순서 불변식이 phase 배치로 보존됨.
- 테스트 매트릭스(해피/네거티브/엣지/예외)는 PLAN.md §3에 작성돼 있음 — etag 파싱·비교표(§8.8.3.2 Table3), http-date 3포맷, evaluate 전 분기(IMS≤→false vs IUS≤→true 비대칭 포함), 배선, e2e(PUT+If-Match 불일치→412+핸들러 미실행 검증).

---

## 2. 남은 일 (순서)

1. **STANDARDS를 v1 범위에 정렬** — 생성 규칙(§1 SHOULD generate/clock/trailer)·If-Range(§2.3·§5.5·§5.6.1)를 "범위 밖(참조)"으로 분리 또는 제거. §8.8.3 ABNF·비교표는 유지.
2. **정렬된 STANDARDS + PLAN을 3엔진 적대리뷰**(codex CLI·grok CLI·claude 서브에이전트 — 사용자가 요구하는 검증 방법론. 코퍼스 원문 대조, ≥2엔진 수렴 또는 원문 명백만 반영).
3. 수렴 후 사용자에게 확정 보고 → 승인 받고 구현 착수.
4. 구현 시퀀스(PLAN §5): http-adapter HttpHeader 7개 추가(별도 선행 커밋 권고) → etag.ts+http-date.ts TDD → evaluate.ts TDD → 배선 → e2e → `zb build middleware` 확인 → README en/ko → 리뷰 → PR.

---

## 3. 행동 규칙 (이 사용자 — 위반 시 심한 질책)

- **시키지 않은 작업 절대 금지.** 질문에는 답만. "다음 뭐 할까요"도 묻지 말고 지시 대기. 계획 단계에서 코드 작성 금지(이번 세션에서 2회 질책받음 — evaluate.ts 등 4파일 조기 작성했다 삭제됨).
- **"완벽/확정/끝" 선언 금지** — 검증(적대리뷰 수렴) 전에는. 상태를 정직하게: 뭐가 검증됐고 뭐가 안 됐는지.
- **모든 주장에 근거** — 코드는 file:line, 표준은 RFC 원문 인용. 추측·기억으로 답하지 말고 반드시 읽고 확인.
- **string-literal 유니온 금지** — 프레임워크 enum(HttpStatus/HttpHeader/HttpMethod) + enum 판별자.
- 문서 예제 API는 소스에서 실재 확인 후 작성(메모리 verify-doc-apis-against-code).
- 과함(cors 패턴 무조건 복사 등) 금지 — 규칙: RFC MUST/SHOULD ∧ 소비자 실재일 때만 v1 포함.
- git stash 금지(워크트리 공유), 훅 우회 금지.
