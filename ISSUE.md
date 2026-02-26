# 로그 레벨 일관성 수정

gildash 0.7.0 마이그레이션 코드 리뷰에서 발견된 로그 레벨 불일치 3건.

## 기준

- **error**: 현재 시점에서 파이프라인이 실패한 상태
- **warn**: 파이프라인은 동작하지만 degraded 상태를 사용자가 인지해야 함
- **silent**: 부가 기능 실패 또는 결과에 영향 없는 cleanup 실패

## 수정 대상

### 1. `packages/cli/src/bin/dev.command.ts:258` — symbol diff catch

현재: `logger.warn`
변경: silent catch

`diffSymbols()`는 added/modified/removed 정보성 로그 생성용.
실패해도 핵심 파이프라인(getAffected → rebuild)에 영향 없음.

### 2. `packages/cli/src/bin/dev.command.ts:295` — SIGINT close

현재: `logger.error`
변경: silent catch

프로세스 종료 중 cleanup. 로그 출력이 보이지도 않을 수 있고 결과에 영향 없음.

### 3. `packages/cli/src/bin/build.command.ts:352` — ledger close in finally

현재: `logger.error`
변경: silent catch

빌드 출력 파일은 이미 작성 완료 후 cleanup. close 실패는 빌드 결과에 영향 없음.
