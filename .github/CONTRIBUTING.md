# CONTRIBUTING

이 문서는 Zipbul 프로젝트에 기여할 때의 기본 절차와 기준을 정의한다.

## 목적

- PR/리뷰/검증의 최소 기준을 고정한다.
- “범위 밖 변경/결정성 위반”을 병합 전에 차단한다.

## 적용 범위

- 내부 기여자의 PR 및 리뷰
- 외부 PR은 제출될 수 있으나, 현재는 적극적으로 받지 않으며 병합을 보장하지 않는다.

## Note

- 현재는 외부 컨트리뷰트를 적극적으로 받지 않는다.
- 다만, 프로젝트가 외부 기여를 받을 준비가 되면 적극적으로 받을 계획이다.
- 제출된 PR은 병합을 보장하지 않으며, 모든 변경은 내부 기준에 따라 평가된다.

## 기본 원칙

- 문서 위계/정본(SSOT) 규칙: [SSOT_HIERARCHY.md](../docs/10_FOUNDATION/SSOT_HIERARCHY.md)

## 로컬 검증

- 검증은 루트 `package.json`의 `verify`로만 수행한다.
  - 허용: `bun run verify`
  - 금지: `packages/*`의 `package.json`에 있는 검증 스크립트 실행

## 커밋 규칙

- 커밋 메시지 규칙은 [COMMITS.md](../docs/50_GOVERNANCE/COMMITS.md)를 따른다.

## PR 기준(요약)

- 범위 밖 변경 금지(요청 범위 외 리팩토링/정리 금지)
- AOT/AST 결정성 위반 금지
- 패키지 경계 침범(deep import) 금지
- `verify` 실패 상태로 병합 금지
