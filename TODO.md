# TODO — 미완료 항목 (2026-03-18)

## 1. E2E 검증

### 클러스터 모드 (workers: 2+) 실환경 검증

- ClusterManager 통합 테스트 27건은 Worker RPC 레벨만 검증 — Bun.serve/reusePort/HTTP 요청 0건
- `Application`에 `workers: 2+` 전달하여 실제 HTTP 요청 분배를 검증하는 E2E 테스트 없음
- Linux 전용 (`application.ts:267-272`에서 non-Linux throw)
- CI 파이프라인(`.github/workflows/ci.yml`)에 `bun test` 스텝 자체가 없음 — 빌드/린트만 실행

## 2. AOT Build-Time Validation — 구조적 한계 / Low Priority

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
