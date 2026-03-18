# TODO — 미완료 항목 (2026-03-18)

## 1. E2E 검증

### 클러스터 모드 (workers: 2+) 실환경 검증

- ClusterManager 통합 테스트 27건은 Worker RPC 레벨만 검증 — Bun.serve/reusePort/HTTP 요청 0건
- `Application`에 `workers: 2+` 전달하여 실제 HTTP 요청 분배를 검증하는 E2E 테스트 없음
- Linux 전용 (`application.ts:267-272`에서 non-Linux throw)
- CI 파이프라인(`.github/workflows/ci.yml`)에 `bun test` 스텝 자체가 없음 — 빌드/린트만 실행

## 2. AOT Build-Time Validation — 구조적 한계

### F-1: 스프레드 번들 내용 검증

- `...bundle.providers` 등 런타임 변수 — AST에서 `ZIPBUL_SPREAD` 마커로 추적하나 실제 내용은 미해석
- 데이터 플로우 분석 없이는 구조적 불가
