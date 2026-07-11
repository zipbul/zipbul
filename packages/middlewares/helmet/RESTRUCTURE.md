# @zipbul/helmet 재구조 계획 (확정) — 10라운드 적대 리뷰 종료

**확정본.** 10라운드 적대 리뷰(codex+grok) 종료. 아키텍처 결함은 6라운드(AOT 2상·native 병합)에서 마지막으로 나온 뒤 4라운드 연속 0건 — (a)순환·(b)하우스·(d)핫패스·(f)과대·(g)이름 clean 고정. 이후 잔여는 전부 의사코드 문장 다듬기라 종료 판정. 미결 코드 문제 6건은 아래 정합 감사 트랙으로 기록(은닉 금지).

## 검증된 컨텍스트
- 공개 배럴 = **패키지 루트 `index.ts`(실재, 유지)**. tsconfig.build.json include ["index.ts","src"], rootDir ".". src/index.ts 공개배럴 신설 안 함(v2 오진 철회). 배럴-필수 규칙은 src/ 내부 디렉토리에 적용(디렉토리 밖에서는 그 디렉토리의 index.ts로만 import).
- 현 공개 표면(동결 대상, 1:1): Helmet, Csp, lintCsp, parseCspReport, hashFromString, HelmetError, HelmetErrorReason, HelmetWarningReason + 공개 타입들. step 1에서 스냅샷 테스트로 고정.
- 3채널 실재: Helmet.warnings(HelmetWarning[]) — 위반(치명, create에서 HelmetError 집계 throw)과 경고(비치명, 보존) 분리. 부분 성공 resolve 실재(잘못된 엔트리 skip+violation 기록).
- PLAN.md(2115줄)의 기존 정책과 정합: public throw 경계, 내부 safe()/isErr 집계, parseCspReport는 typed union/throw 계약 유지. presets 등 기능 계획은 PLAN.md 소관 — 재구조는 이를 변경하지 않고 PLAN.md에 구조 절만 갱신.
- cors 의존 전례: baker·result=dependencies, common·http-adapter=peerDependencies(+dev). sideEffects: cors/query-parser=["**/options.js"](Recipe 등록 보존), helmet 현재 false.
- knownEndpoints 교차 흐름: RE resolved → CSP report-to·NEL report_to·COOP/COEP report-to 파라미터·Integrity-Policy endpoints 검증에 소비(현 options.ts:59-317).
- HttpAdapterPhase 실측: helmet 미들웨어 = **BeforeResponse**. 커버 범위 정직화: 어댑터는 pre-route 에러(OnRequest Err·pipelineError·라우트 미스)에서 writeErrorResponse 후 즉시 return하므로 **BeforeResponse가 돌지 않는다**(http-adapter.ts 실측) — 본 미들웨어의 보장은 **라우트 파이프라인 응답**이고, pre-route 에러 응답의 보안 헤더는 어댑터 소관 경계로 문서화(어댑터 개선 제안은 별도 트랙).
- 공개 표면 동결의 의미: **삭제·시그니처 변경 금지**. 의도적 추가(step 7의 helmetMiddleware)는 허용하되 같은 커밋에서 스냅샷 갱신. 스냅샷 범위 = 모듈 export 키 + Helmet static 멤버 + prototype 공개 멤버 + 공개 타입 목록(모듈 키만으로는 Helmet의 정적 표면 변화를 못 잡음).
- 기존 버그 **4건** 발견·기록(수정은 정합 감사 단계, 은닉 금지): (1) derive()의 rebuildOptions가 documentPolicy 3종 드랍(helmet.ts:556-657), (2) DIP-RO 값 미검증, (3) DP report-to 파라미터 knownEndpoints 미대조, (4) **DP report-to를 sf-token으로 emit(serialize.ts:64)** — STANDARDS §13.3.6/§13.3.13은 UA가 **string일 때만** 채택 → 리포팅 무력화(스펙 테스트도 token 기대라 STANDARDS와 어긋난 상태). step 5에서 이 경로를 건드리므로 같은 커밋에서 String 직렬화로 교정 + **기존 spec(`;report-to=ep` token 기대)도 String 기대로 동시 갱신**(테스트가 버그를 고착시키던 상태 해소). **`messageFormatter`는 버그5**(JSDoc 계약 확정·적용 코드 0건). **재구조 범위: DTO의 isFunction 검사만.** 미결 설계 항목(포맷 적용 위치, 실패 warning 채널 — HelmetError엔 warnings 없고 성공 인스턴스에만 있음, derive 시 formatter 보존 — resolved/rebuildOptions에 없음)은 **정합 감사 트랙에서 확정**(공개 표면 변경 가능성 있어 재구조 스냅샷과 분리; PLAN L631 resolved 설계와 현 타입 불일치도 그때 해소). step 4 체크리스트에 **derive round-trip 골든** 포함.

## 아키텍처
- 2상: [생성 1회] baker coarse-shape 검증 → feature resolve/validate → 동결 HeaderEntry[] (CSP는 NONCE_PLACEHOLDER 사전 토큰화) / [요청] stamp(논스 치환)만. 핫패스에 baker·result·구조체 할당 금지.
- feature 계약(기준선): `resolveX(input, path): {value, violations, warnings}` 3채널 구조체 / `validateX`(동적 키·교차 필드) / `serializeX(resolved): HeaderEntry[]` **무실패·빈 배열 허용**(현 `HeaderEntry | undefined` 반환은 `HeaderEntry[]`로 통일). **명시 예외 표**: csp는 resolve에 fallback 파라미터('default-on'|'report-only')가 추가되고 compile 산출물이 논스 템플릿(HeaderEntry[]가 아님); remove-headers는 serialize 대신 핫패스 `apply` 계약. 예외는 이 표 밖으로 늘리지 않는다.
- helmet.ts: 정적 손조립(레지스트리 없음). **RE-first 계약**: knownEndpoints를 csp·nel·coop·coep·integrity-policy·**document-policy(report-to 파라미터, §13.3.6)**의 validate에 인자 주입. violations 전건 집계 → HelmetError 1회 throw. warnings 보존. **Report-To 합성(serializeReportToFromEndpoints)은 오케스트레이터 소유**로 이전(helmet.ts 비공개 함수) — RE·NEL 분할 후 어느 feature 배럴에도 두지 않는다(양방향 의존 차단). **enforceHeaderValueBytes는 compile 후 오케스트레이터 전용 후처리**(횡단 한도, 루트 constants 소유)로 명시 — feature serialize 무실패 계약과 양립.
- @zipbul/result: PLAN.md 정책 그대로 — 내부 수집(safe()/isErr), parseCspReport 내부 JSON 파싱 safe() 래핑(공개 계약은 불변). 죽은 의존 → 실사용 전환.
- baker: 최상위 coarse shape 전용(의미 룰은 feature validate). **타입 관계 확정**: 공개 타입은 기존 `HelmetOptions` 인터페이스 그대로(동결), `HelmetOptionsDto` 클래스는 **비공개 검증 전용**(index 미export, create 입력은 HelmetOptions, DTO는 validateSync 대상일 뿐) — cors의 '옵션 클래스=공개 타입'과 다른 선택임을 명기. `messageFormatter`(함수 필드)는 DTO에서 isFunction 검사로 포함. **DTO 필드 키 = HelmetOptions 키 1:1 패리티 테스트**(누락 필드가 forbidUnknown에 걸려 조용히 거부되는 것 방지). **unknown 키 거부 1순위 = `new Baker({ forbidUnknown: true })`**(BakerConfig.forbidUnknown 실재 확인), 폴백 = Object.keys 대조. 고정키 nested DTO는 소수만 2순위. step 6 체크리스트: package.json dependencies에 `@zipbul/baker: catalog:` 추가 + `sideEffects: ["**/options.js"]` + **루트 index.ts에 side-effect `import './src/options'`**(query-parser index.ts 전례 — 등록 보존) + forbidUnknown 테스트.
- **dependency-cruiser**(helmet 패키지 로컬 도입) 경계: feature↔feature 금지(type-only 포함), feature→{options.ts, helmet.ts, middleware.ts, 루트 index.ts} 금지, structured-fields→feature 금지, 비-배럴 deep import 금지. **예외: `*.spec.ts`는 루트 index import 허용**(현 cache-control.spec.ts 전례 — 공개 API 경유 테스트는 정당). 배럴 export 화이트리스트: 계약 함수+공개 타입만.

## create 파이프라인 (C1 — 순서 고정)

```
Helmet.create(options):
  1. helmetBaker.validateSync(HelmetOptionsDto, options)   # coarse shape + forbidUnknown
       → BakerIssueSet면 **fail-fast 즉시 throw**(coarse shape/타입/오타 오류는 더 볼 것 없음). 매핑: issue.context.reason 있으면 그 reason, whitelistViolation→HelmetErrorReason.UnknownOption, **context.reason 없는 그 외 이슈는 internal Error**(cors 전례 — raw baker 표면이 공개 경계로 유출 금지). 여기서의 throw는 baker **첫 issue 1건만 매핑**(대량 unknown key도 UnknownOption 1건으로 요약 — cap 대상 아님)
  2. resolved = {}; violations=[]; warnings=[]
     reporting-endpoints를 먼저 resolve (knownEndpoints 확보)
     나머지 feature resolve(input,path) → {value,violations,warnings} 누적
     feature validate(resolved, knownEndpoints) → violations/warnings 누적   # 동적키·교차필드·RE주입·SF직렬화가능성
  2b. throwIfViolations(violations)   # = cap(violations) 후 length>0면 throw. compile 전 게이트(dirty resolved 금지)
  3. compiled = compile(resolved)                          # clean resolved 전용, 동결 HeaderEntry[] + nonce 템플릿
  4. enforceHeaderValueBytes(compiled) → violations 누적    # 횡단 후처리(오케스트레이터 소유)
  5. throwIfViolations(violations)   # 동일 helper: cap 후 throw. 2b·5는 한 create에서 하나만 도달
  # capViolations는 throwIfViolations 안에 있어 어느 throw 경로든 캡을 거친다(2b 경로가 cap 없이 throw되던 모순 제거)
  7. return new Helmet(resolved, compiled, warnings)
```
serialize는 이 흐름에서 **무실패**: 2단계 validate가 **SF 직렬화 가능성(key·token·sf-string·integer·decimal 문법; decimal은 finite·**반올림 후** 정수부 12자리(serializer가 범위검사→반올림 순이라 경계값이 13자리로 넘어갈 수 있음 = 버그6, validate는 반올림 후 재검사))까지 검증**(DocumentPolicyValue의 number가 serializeItem→serializeDecimal throw 경로를 가짐)하므로(codex-2 — SF 기반 feature의 serialize가 structured-fields serializer의 throw 경로를 갖기 때문), compile 시점엔 문법 위반이 남지 않는다. baker/result/구조체는 1~2b에만, 요청 경로 무접촉.

## 미들웨어 계약 (D1·E1·E2·E3·H1 완결)

`helmetMiddleware(options?: HelmetOptions): { onRequest, beforeResponse }` — cookie형 2상 pair. `Helmet.create(options)`를 **1회** 호출해 클로저에 가둔다(매 요청 create 금지).

- **논스 정책: 항상 생성·publish**(`nonce:false` 개념 없음 — provides/use 계약을 깨는 조건부 미publish를 제거). OnRequest 상: `const nonce = Helmet.generateNonce(); ctx.set(helmetNonceKey, nonce)`, `provides:[helmetNonceKey]`(핸들러가 `ctx.use(helmetNonceKey)`로 소비 — OnRequest가 항상 set하므로 핸들러 use는 안전; 미들웨어 자신의 beforeResponse는 위 D1 이유로 get 사용). 생성 비용은 요청당 crypto 16B+map.set 1회로 무시 가능. CSP에 논스를 **실제로 주입할지**는 Helmet.create의 CSP 설정(nonce 템플릿 유무)이 결정 — 미들웨어는 논스를 항상 흘려보내고 주입은 헤더 컴파일이 판단.
- **스탬프: BeforeResponse 상 in-place 변이만** — `helmet.applyHeadersTo(http.response.headers, { nonce: ctx.get(helmetNonceKey) })` — **`ctx.get`(optional)+undefined 가드, `ctx.use` 아님**(cookie beforeResponse 전례). 이유: FORM2가 2상 pair를 한 exportName의 producerInfo로 합쳐 멤버별 identity가 없으므로 `use`의 consumer 검증이 오판·런타임 throw 위험(codex D1 실측). `apply(Response)`는 **새 Response를 만들어 어댑터에 재부착 안 되므로 금지**, `headersRecord()`는 매 요청 객체 생성이라 금지. `applyHeadersTo`가 무할당 경로.
- **isSent 가드(첫 줄)**: `if (http.response.isSent()) return;` — 이미 전송된 응답에 late write 방지(status 가드보다 먼저).
- **status 가드**: buffered 응답만 helmet 소관 — `const s = http.response.getStatus(); if (s !== undefined && (s<200 || s===304)) return;`, `applyHeadersTo` 전. **`getNativeResponse()`는 절대 호출 금지**(finalizer 후 전용·`_headers` merge 캐시 mutation). native Response의 1xx/304 가드는 어댑터 소관으로 한계표에 명시(공개 API에 non-mutating native status peek이 없음 — 공개 API에 native status peek 메서드 자체가 부재 — 실측 전체 0건; 어댑터에 `peekNativeStatus()` 추가는 별도 선행 트랙). `http.response.isSent()` early-return 준수.
- **등록 계약**: pair는 **양쪽 phase 모두 등록해야** 완결(OnRequest만 → 논스만 생기고 헤더 없음; BeforeResponse만 → get이 undefined라 논스 없는 CSP). JSDoc·README에 양쪽 등록 명시. `helmetMiddleware`는 `Helmet.create` 시점에 `@throws HelmetError`(옵션 검증 실패).
- **`HelmetMiddlewareOptions` 불필요**: 미들웨어 옵션 = `HelmetOptions` 그대로(논스 정책 옵션을 없앴으므로 별도 타입·baker 이중 스키마 불필요).
- **보장 범위 표**(H1): pre-route 에러(OnRequest Err·pipelineError·라우트 미스)는 어댑터가 writeErrorResponse 후 즉시 return → **BeforeResponse 미실행 → 헤더 안 붙음(어댑터 소관 경계)**. 라우트 매칭 후 핸들러 에러는 WriteResponse→BeforeResponse 순이라 **헤더 붙음**. 이 비대칭을 문서화. **native Response 한계(codex D2 실측)**: 핸들러가 native `Response`(SSE·streaming·handler Response)를 반환하면 어댑터 `getNativeResponse()` 병합이 `!merged.has(key)`로 **native 우선**이라, 핸들러가 명시한 보안 헤더를 helmet이 **덮지 못한다**(helmet 헤더는 핸들러 미설정 키에만 적용). 이 한계를 문서화하고, `applyHeadersTo`는 `http.response.headers`(=_headers 오버라이드)에 쓰므로 buffered 응답에선 정상 우선. **어댑터에 '보안 헤더 오버라이드 우선' 병합 옵션 제안은 별도 트랙**(helmet만을 위한 어댑터 변경은 이 재구조 범위 밖).

## 트리 (v2에서 변경분만)
- 루트: index.ts(기존, 공개 동결) / helmet.ts / middleware.ts★(2상: OnRequest publish + BeforeResponse stamp, common은 peer+dev) / context-keys.ts★(helmetNonceKey) / coop-coep.ts★(COOP·COEP 공유) / reserved-key-guard.ts(internal/에서 루트로) / options.ts(HelmetOptionsDto coarse만) / baker.ts★ / errors.ts(HelmetError — 하우스 통일 아님, 이 패키지의 선택으로 명기) / types.ts(HeaderEntry·ViolationDetail·HelmetWarning 확정 배치) / interfaces.ts / enums.ts / constants.ts(횡단 공유만: RESERVED_KEYS, headerValueBytes)
- LIMITS 해체 규칙: 소비 1개 → feature constants.ts, 2개+ → 루트 constants.ts. **reserved-key-guard는 함수라 constants.ts 불가 — 루트 `reserved-key-guard.ts` 단일 파일**(소비자 4: csp·document-policy·permissions-policy·reporting-endpoints). **COOP/COEP 공유 로직**(resolveCoopCoep·resolveCoopCoepReportOnly·validateCoopOrCoep 실재)은 coop↔coep 상호 import가 depcruise 위반이므로 **루트 `coop-coep.ts` 공유 파일**에 두고 coop·coep가 각각 import(feature→루트 공유파일은 허용 방향). **NONCE_PLACEHOLDER**는 csp/serialize·helmet 스탬프 2곳 소비이나 CSP 도메인이므로 `csp/constants.ts` 소유 + helmet이 csp 배럴에서 import.
- feature **24개**(실측 현 22 + `document-isolation-policy` 신설 + `reporting`→`reporting-endpoints`+`nel` 분할 순증 1) + structured-fields. csp/는 hash.ts·lint.ts·reports.ts 흡수. 신설/분할 디렉터리명 확정: `document-isolation-policy`, `reporting-endpoints`, `nel`.

## 마이그레이션 (각 단계 bun test+typecheck 그린 — step 4는 기능 단위 복수 커밋 허용(이중 이주 아님), 골든 헤더 스냅샷 + **벤치 게이트**: mitata(PLAN L1367 정합), 체크인 베이스라인 `test/bench-baseline.json`(측정 대상: stamp·headers·applyHeadersTo·generateNonce), 이 대비 p50 -5% 초과 회귀 시 실패, 베이스라인 갱신은 전용 커밋으로만, warm-up 후 p50 측정(CI 노이즈 대비; CodSpeed p99 +10%는 PLAN CI 트랙 별도). 현 test/helmet.bench.test.ts는 로그-only 비-게이트 → 개조.
1. 공개 export 스냅샷 테스트 작성(동결 선언) — 대상 명시(런타임 표면 전건): (i) 모듈 export 키 전건, (ii) `Helmet` 정적 멤버(create·generateNonce·csp·hsts·permissionsPolicy·referrerPolicy·xFrameOptions·xContentTypeOptions·crossOriginOpenerPolicy·crossOriginResourcePolicy·crossOriginEmbedderPolicy·originAgentCluster·endpoints), (iii) `Helmet` prototype 공개 메서드(headers·headersRecord·applyHeadersTo·apply·derive·toJSON·headerNames·headersToRemove; `warnings`는 instance own property라 인스턴스 생성 후 별도 확인), (iv) `Csp` 객체 키 전건, (v) step 7 이후엔 `helmetMiddleware`·`helmetNonceKey`·`HelmetMiddleware` pair 타입도 스냅샷 대상(cookie/index.ts가 cookieMiddleware·cookieJarKey·CookieMiddleware를 export하는 전례), `HelmetErrorReason`·`HelmetWarningReason` **enum 멤버 전건**(step 6의 UnknownOption 신설이 이 스냅샷을 깨므로 같은 커밋에서 갱신), (vi) 공개 타입 export 목록. **prototype 스냅샷은 TS private 런타임 잔존을 화이트리스트로 배제**. **name-only로는 시그니처 변경(인자/리턴)을 못 잡으므로 `tsd`(devDep) d.ts 시그니처 assertion 병행 — package.json에 `tsd` 스크립트 + `test-d/` 경로 체크인**(Helmet static/prototype 공개 멤버의 파라미터·리턴 타입 고정; `HeaderEntry`는 배럴 미export이나 공개 메서드 시그니처에 노출되는 타입이라 포함)
2. 루트 덤프 다이어트: 타입·상수 소유 feature로(LIMITS 규칙 적용, ViolationDetail→types.ts 확정)
3. csp 통합 이주: hash/lint/reports→csp/, header-entry→types.ts, reserved-key-guard→루트 `reserved-key-guard.ts`(소비자 4), COOP/COEP 공유 헬퍼→루트 `coop-coep.ts`, `Csp`·NONCE_PLACEHOLDER→csp/constants.ts(루트 index.ts의 `Csp` re-export 유지·공개 동결)
4. options.ts 해체 + feature 계약 3채널 구조체 전환을 기능 단위 커밋으로(복수 커밋 허용 — 이중 이주 아님), helmet.ts 집계 전환 병행 + **LIMITS.violations 집계 캡(현 options.ts:328-337)은 오케스트레이터가 baker+resolve+validate+enforce 전부 수집 후 throw 직전 1회 적용**(캡 우회·이중 캡 방지) + enforce vs RO 강도 비교(compareCspStrength)는 csp/validate 내부(2-arg, 교차 feature 아님) + derive round-trip 골든
5. DIP 적출 신설, reporting 분할 + RE-first 주입 계약 + serializeReportToFromEndpoints를 reporting 배럴에서 제거→helmet.ts 비공개 이전 + **해당 spec(현 reporting.spec.ts의 Report-To 합성 케이스)은 helmet.spec.ts로 이전**(오케스트레이터 소유 함수의 테스트도 오케스트레이터 스코프)
6. baker 도입: baker.ts(+최초 create 시 lazy seal, cors ensureSealed 전례) + options.ts(coarse DTO — 전 @Field에 context.reason 필수) + **BakerIssueSet→ViolationDetail[] 매핑 규칙 명문화**(issue.path→path, context.reason→reason; forbidUnknown 이슈는 context가 없으므로 **HelmetErrorReason.UnknownOption 신설**로 매핑 — raw baker 표면이 공개 경계로 새는 것 금지, PLAN의 'create는 HelmetError만' 유지) + `new Baker({forbidUnknown:true})` + sideEffects 변경 + 루트 index side-effect import + unknown-key·매핑 테스트
7. middleware.ts + context-keys.ts 구현 — 아래 「미들웨어 계약」 절 그대로. @zipbul/common은 peer+dev, mitata·dependency-cruiser는 devDep.
8. 디렉토리 배럴 정비 + dependency-cruiser 경계 도입 + 공개표면 스냅샷 재통과 확인
9. PLAN.md 갱신 — 구조 절 + **「결과 모델」절(L156-161)을 3채널 구조체+오케스트레이터 집계로 개정**(safe()는 parseCspReport JSON 파싱 등 throw 가능 구간 한정으로 축소) — 실행 기준과 PLAN의 모순 제거

## 공격 지점 (남은 결점만, 근거 필수. 카테고리 clean이면 clean)
(a) 순환·경계 구멍 (b) 하우스 위반 (c) baker/result 계약 결함 (d) 핫패스 퇴행 (e) 마이그레이션 파손 지점 (f) 과대/과소 (g) 이름·배치 (h) 누락
