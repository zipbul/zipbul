# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Identity

Zipbul은 **예측 가능성과 명시성을 최우선으로 하는** Bun 전용 백엔드 프레임워크다. Bun only, ESM only, TypeScript only.

핵심 설계 원칙:
- **빌드 타임 지능**: 모든 판단(DI 와이어링, 파이프라인 구성, 핸들러 라우팅)은 빌드 타임에 완료. 런타임은 결정된 경로를 따라가기만 한다.
- **런타임 리플렉션 절대 금지**: `reflect-metadata` 사용은 정책 위반. DI는 정적 팩토리 호출로 변환된다.
- **프로토콜 무관 코어**: 비즈니스 로직은 HTTP/WebSocket 등 프로토콜을 모른다. Adapter가 프로토콜을 격리한다.
- **Result 패턴**: 도메인 실패는 예외가 아니라 `Result<T, E>` 값으로 표현한다.
- **구조가 규칙을 대체**: 설명이 필요하다는 건 구조가 불완전하다는 신호다.
- **명시성 > 편의성**: 암묵적 변환/주입/파이프 삽입 없음. 등록하지 않으면 실행 안 된다.

## Commands

```bash
bun install                # 의존성 설치
bun test                   # 전체 테스트
bun test path/to/file.spec.ts  # 단일 테스트
bun test --coverage        # 커버리지
bunx oxlint --type-aware   # 린트
bunx oxfmt --write .       # 포맷
bun run knip               # 미사용 코드 검출
bun run deps               # 순환 의존 검사
```

```bash
zb dev                     # AOT 컴파일 + watch → .zipbul/
zb build                   # 프로덕션 빌드 → dist/
bun dist/entry.js          # 프로덕션 실행
```

## Monorepo Structure

Bun workspaces. 6개 패키지 (`packages/`):

| Package | Role |
|---------|------|
| `@zipbul/cli` | AOT 컴파일러, dev/build 명령, MCP 서버 |
| `@zipbul/core` | DI 컨테이너, 앱 부트스트랩, 모듈 시스템 |
| `@zipbul/common` | 공유 타입, 인터페이스, 데코레이터, 에러 |
| `@zipbul/http-adapter` | HTTP 서버 어댑터, 라우팅, 미들웨어 |
| `@zipbul/logger` | 구조화된 로깅 |
| `@zipbul/scalar` | OpenAPI 스펙 생성 + Scalar UI |

패키지는 TypeScript 소스 그대로 배포 (패키지별 빌드 스텝 없음).

## Code Architecture & File Structure

### 파일 책임
- SRP: 파일은 단일 책임. 기능 또는 도메인 단위로 응집
- 1 class 1 file
- `utils.ts` / `helpers.ts` 금지. 기능/도메인명으로 파일 작성
- 파일명: `kebab-case`. 예약 파일명 예외: `index.ts`, `types.ts`, `interfaces.ts`, `enums.ts`, `constants.ts`
- 마이크로 파일 가드레일: 비테스트 20 LOC 미만 단일 함수/상수 → 기본 병합. Public Facade/API 경계/재사용(2+) 예외만 허용

### 디렉토리 계층
- domain > feature 계층 구조
- feature가 파일 2개 이상이면 디렉토리 생성. 단일 파일은 상위에 flat 배치
- 디렉토리명: `kebab-case`
- 모듈 경계는 파일 시스템 디렉토리 구조로만 결정. 별칭/심볼릭 링크 금지

### 선언 파일 분리
- 대상: type, interface, enum, constant
- 조건: 2개 이상 파일에서 사용될 때만 `types.ts`, `interfaces.ts`, `enums.ts`, `constants.ts` 생성
- 단일 파일에서만 사용되는 선언은 해당 파일에 named type으로 선언 (인라인 오브젝트 타입 금지)

### 모듈 구조
- Feature 단위 모듈 (수직 응집)
- 배럴: `index.ts`에 명시적 named export. `export *` 금지
- 패키지 외부 노출은 `index.ts` Facade 하나뿐. deep import(`@zipbul/*/src/`) 금지

### 패키지 의존성
- import와 의존성 선언 불일치 금지. 런타임 import → `dependencies`/`peerDependencies` 선언 필수
- 워크스페이스 루트 호이스팅에 기대는 선언 누락 금지
- `optionalDependencies` 기본 사용 금지
- 런타임 어댑터/플러그인: 코어/공통 패키지는 `peerDependencies`로 선언

## Naming

- 클래스/인터페이스/타입/Enum 이름: `PascalCase`. Enum 항목: `PascalCase`
- 함수/변수: `camelCase`. 상수: `SCREAMING_SNAKE_CASE`
- 인터페이스 `I` 접두사 금지
- 한 글자 식별자 금지. 예외: `i/j/k`, `_`, `T`
- 콜백 파라미터: 자연어 의미명 필수. 예외 없음
- 컬렉션: 복수 명사. 순회 변수: 단수 명사. Map: 키 의미명(`productsById`)
- 해석 불가능한 약어 금지 (`a`, `b`, `p`, `v` 등)

## Type System

- Interface 우선. Type은 interface 불가 시만 (유니온, 교차, 제네릭 discriminated union, 조건부 타입 등)
- Enum 적극 사용. 값 그룹핑 → enum. 문자열 Enum 기본. `const enum` 금지
- Union Type: enum 불가 시만 (타입 수준 연산, 제네릭 조합)
- `as const`: enum 대체 가능하면 금지. enum 불가 시만 허용
- 인라인 오브젝트 타입 금지. 인라인 함수 시그니처 금지. 반드시 named type/interface로 선언
- `any` 금지 (표현 불가 시만). `unknown` IO 경계에서만, 즉시 좁히기
- `Record<string, any>` 금지. Public/Shared에서 `object`/`Function` 금지
- `as` 단언 금지. `satisfies` 권장
- 타입 중복 금지. SSOT 단일 출처 + TS 유틸 파생 (최대 3단계)
- 우산 타입 금지 (`AnyValue`, `AnyFunction` 등)

## Code Style

- early return 후 `else` 금지
- Shorthand property 선호. 브래킷 표기법 금지 (동적 키 예외)
- `??`/`||`/`?:` 엄격 구분. `null` vs `undefined` 엄격 구분 (`undefined`=없음, `null`=의도적 비어있음)
- 동일 리터럴 2회+ → 상수/enum 추출. 그룹 값 → enum, 단일 값 → const
- 스프레드: config/options 소형 객체만 허용. 도메인 엔터티/컬렉션/외부 입력 금지
- 로컬 상수 금지. `constants.ts` 또는 클래스 프로퍼티로 선언
- 불변성: 인자 객체/배열 변형 금지. `readonly` 권장

## Function & Class Design

- Class 사용 기준 (하나라도 해당 시):
  - 인스턴스 생성 + 데코레이터
  - `extends` 필요한 구조적 상속
  - `implements` 필요한 계약 이행
  - 상태 캡슐화 (`private`/`#` 필드)
- Function: 위 외 모든 경우
- 함수 파라미터 3개 초과 시 interface화
- Public Instance Method: 유닛 테스트 용이한 크기로 분해
- Static Method: 기본 금지. Factory/순수 유틸/정적 공유 상태에만 예외

## Quality

- 중복 코드 금지 (DRY). 재사용 시 즉시 함수/모듈로 단일화
- Floating Promise 금지. `Promise.all` 사용 시 동시성 제한 고려
- Deprecated: 내부 코드 즉시 삭제. Public API `@deprecated`는 사용자 논의 필수

## Documentation

- Public API TSDoc 필수: `@param`, `@returns`, `@public`, `@example` 등 풍부하게 작성
- `// TODO`, `// FIXME` 절대 금지
- `eslint-disable`, `@ts-ignore`, `@ts-expect-error` 절대 금지

## Commit Convention

`type(scope): subject` — commitlint + husky 강제.

- **Scopes**: `cli`, `common`, `core`, `http-adapter`, `logger`, `scalar`, `examples`, `repo`, `config`, `plan`, `eslint`, `scripts`
- **Types**: `feat`, `fix`, `refactor`, `test`, `docs`, `build`, `chore`, `ci`, `perf`, `revert`, `style`
- kebab-case scope, 끝에 마침표 금지, 본문 100자 제한, 단일 scope만

## Rules Routing

작업 전 해당하는 규칙 파일을 반드시 읽을 것.

| 상황 | 읽을 파일 |
|------|-----------|
| 코드 작성/수정 | `docs/40_ENGINEERING/STYLEGUIDE.md` |
| 테스트 작성/수정 | `.ai/rules/test-standards.md` |
| 런타임/라이브러리 선택 | `.ai/rules/bun-first.md` |
| 아키텍처/설계 판단 | `docs/10_FOUNDATION/INVARIANTS.md` |
| AOT 컴파일러 작업 | `packages/cli/src/compiler/` 구조 파악 후 관련 spec (`docs/30_SPEC/`) |
