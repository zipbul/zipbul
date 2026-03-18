# TODO — 미완료 항목 (2026-03-18)

## 1. Examples 미비

### TODO 12: 글로벌 exception filter — dead code 또는 미등록

- `examples/src/filters/http-error.filter.ts`에 `httpExceptionFilter`가 정의되어 있으나 어디에도 등록/임포트되지 않음
- 프레임워크는 글로벌 필터 없이도 `500` 응답 반환 (`Adapter.runExceptionFilters()` → `err({ message: 'Unhandled error' })` → `writeErrorResponse()` fallback)
- 기능 결손이 아닌 **dead code** — 등록하거나 삭제 중 택1
- 등록 시: `httpAdapter.addExceptionFilters([httpExceptionFilter])` 또는 모듈 `adapterConfig.exceptionFilters`
- 등록 시 추가 이점: 에러 응답에 `path`, 원본 메시지 포함 (현재 fallback은 `Internal Server Error`만 반환)

## 2. E2E 검증

### 클러스터 모드 (workers: 2+) 실환경 검증

- ClusterManager 통합 테스트 27건은 Worker RPC 레벨만 검증 — Bun.serve/reusePort/HTTP 요청 0건
- `Application`에 `workers: 2+` 전달하여 실제 HTTP 요청 분배를 검증하는 E2E 테스트 없음
- Linux 전용 (`application.ts:267-272`에서 non-Linux throw)
- CI 파이프라인(`.github/workflows/ci.yml`)에 `bun test` 스텝 자체가 없음 — 빌드/린트만 실행

## 3. Bun 최적화 (기능 영향 없음)

### BUN-OPT-1 (P2): handleCrash() 이벤트 타입별 진단 정보 미추출

- 근본 원인: `handleCrash()`의 3번째 파라미터 타입이 `Error | Event`이지만 `instanceof Error`로만 분기 (`cluster-manager.ts:390-391`)
- 3개 호출부(line 259 `ErrorEvent`, 264 `MessageEvent`, 275 `CloseEvent`)에서 Event 서브타입이 전달되나 진단 정보 전부 소실
- `CloseEvent`: `.code`(종료 코드), `.wasClean`, `.reason` 소실. Bun 공식 문서에서 `process.exit(n)` 코드가 `.code`에 전달됨을 명시
- `ErrorEvent`: `.error`(내부 Error 객체), `.message`, `.filename`, `.lineno` 소실. 실제 스택 트레이스를 가진 Error가 unwrap 안 됨
- 해결: `handleCrash()`에서 `CloseEvent`/`ErrorEvent`/`Error` 각 타입별 진단 정보 추출 + 구조화된 로깅

### BUN-OPT-3 (P3): evaluateMemoryPressure() — GC 시도 없이 단일 RSS 측정으로 recycle 결정

- 근본 원인: `evaluateMemoryPressure()`가 단일 RSS 값으로 즉시 recycle/crash 결정. GC를 먼저 시도하지 않으므로 GC로 회수 가능한 메모리도 위반으로 판정
- soft limit 도달 → 즉시 `recycleWorker()` (line 823-826), hard limit 도달 → 즉시 `handleCrash()` (line 818)
- 해결: soft limit 도달 시 `bun:jsc`의 `edenGC()` 선행 호출 후 재측정. GC 후에도 초과 시에만 recycle
- 부차 가치: `heapSize` + RSS 이중 지표로 mmap 워크로드에서의 false positive 감소
- `bun:jsc`는 공식 `bun-types`에 포함된 public API
- `ClusterWorkerStats`에 `heapSize`, `heapCapacity` optional 필드 추가 (additive, non-breaking)

### BUN-OPT-4 (P3): waitForOpen() — 이벤트를 타이머로 감지하는 설계 오류

- 근본 원인: `waitForOpen()`이 Worker의 `open` 이벤트를 감지하는데 이벤트 리스너가 아닌 타이머 폴링을 사용. 타이머를 `slot.timers`에 등록하면 `transition()`의 `clearSlotTimers()`에 의해 파괴되므로 추적 불가능한 10ms 폴링으로 우회 (`cluster-manager.ts:336-364`)
- `waitForOpen`이 이 문제의 유일한 피해 사례 (다른 untracked 타이머는 독립 cleanup 메커니즘 보유)
- 해결: `waitForOpen()`을 `addEventListener('open', resolve, { once: true })` 이벤트 리스너 방식으로 전환. `clearSlotTimers()`는 이벤트 리스너를 건드리지 않으므로 문제 해소
- `slot.timers` 버킷 분리는 현재 불필요 — 피해 사례가 `waitForOpen` 하나뿐

## 4. AOT Build-Time Validation — 구조적 한계 / Low Priority

### E-2: 파라미터 데코레이터 종류와 TS 타입 간 불일치 검증 부재

- 데코레이터(`@Body`, `@Query` 등)는 no-op 반환 — AST 마커 역할만
- `@Body() body: string`에 JSON 객체 전송 시 타입 강제 없이 raw 객체가 silent pass-through
- 빌드 타임에 데코레이터 종류와 파라미터 타입 조합의 타당성 검증 가능

### E-3: metatypeKey 레지스트리 미등록 시 silent 역직렬화 skip

- `resolveParamType()`에서 미등록 키는 raw string 반환 → `typeof metatype === 'function'` 실패 → 역직렬화 skip
- 사용자는 `@Body() body: UserDto`에서 DTO 파싱을 기대하지만 raw JSON이 전달됨
- 분석 단계에서 알려진 클래스 목록과 metatypeKey 교차검증으로 빌드 타임 검출 가능

### E-4: 미데코레이팅 파라미터의 silent undefined

- 데코레이터 없고 이름이 body/query/params에 해당하지 않는 파라미터는 `undefined` 수신
- `getUser(id: number)` → `id`가 `undefined` → 다운스트림 쿼리 오류
- 빌드 타임 경고로 검출 가능

### F-1: 스프레드 번들 내용 검증

- `...bundle.providers` 등 런타임 변수 — AST에서 `ZIPBUL_SPREAD` 마커로 추적하나 실제 내용은 미해석
- 데이터 플로우 분석 없이는 구조적 불가

### K-2: gildash semantic fallback의 무차별 catch

- 근본 원인: `build.command.ts:250-256`의 catch 블록이 semantic 실패만 잡아야 하는데 모든 에러를 무차별 catch
- `GildashError`에 이미 `.type` 필드 존재 (`'semantic'`, `'validation'`, `'store'` 등) — 분류 수단이 있으나 사용하지 않음
- non-semantic 에러(DB 손상, 경로 검증 실패 등)까지 semantic fallback으로 처리 → 두 번째 `openGildash()` 호출도 동일 원인으로 실패 → 원본 에러 맥락 소실
- 해결: `e instanceof GildashError && e.type === 'semantic'` 조건으로 catch 범위 한정. non-semantic 에러는 re-throw
