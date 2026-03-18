# TODO — 미완료 항목 (2026-03-18)

## 1. CI

### CI 파이프라인에 `bun test` 스텝 추가

- `.github/workflows/ci.yml`에 빌드/린트만 실행 — 테스트 미실행
- 클러스터 E2E 포함 전체 테스트가 CI에서 돌아야 regression 감지 가능

## 2. AOT Build-Time Validation — 구조적 한계

### F-1: 스프레드 번들 내용 검증

- `...bundle.providers` 등 런타임 변수 — AST에서 `ZIPBUL_SPREAD` 마커로 추적하나 실제 내용은 미해석
- 데이터 플로우 분석 없이는 구조적 불가
