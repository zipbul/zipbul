# RULE_REPORT.md

> **범위**: 코딩 스타일 / 코드베이스 아키텍처 / 디렉토리 구조 / 파일 구조
> 프레임워크 런타임 동작, 거버넌스/프로세스, 테스트 규칙은 제외.
>
> **상태**: 전 항목 확정 완료.

---

## 1. 기술 선택 제약

출처: `.ai/rules/bun-first.md`, `docs/10_FOUNDATION/INVARIANTS.md`

- 1-1. [확정] Bun 런타임 전용. Node.js 호환 타협 코드 금지

- 1-2. [확정] 구현 우선순위: Bun built-in > Node.js API > npm 패키지 > 직접 구현

- 1-3. [확정] Node.js/npm/직접 구현 선택 전 Bun 대안 검색 필수. Bun 대안 존재 시 반드시 사용

---

## 2. 디렉토리 구조

출처: `docs/20_ARCHITECTURE/STRUCTURE.md`

### 2-1. 디렉토리 명명

- 2-1-1. [확정] 디렉토리명: `kebab-case`. 예외: `docs/<NN>_<NAME>/`, 점(.)으로 시작하는 루트 디렉토리

### 2-2. 모듈 경계

- 2-2-1. [확정] 모듈 경계는 파일 시스템 디렉토리 구조로만 결정

- 2-2-2. [확정] 컴포넌트/모듈 ID는 정규화된 파일 경로만. 별칭/심볼릭 링크 금지

---

## 3. 패키지 구조 및 의존성 (코드베이스 아키텍처)

출처: `docs/20_ARCHITECTURE/STRUCTURE.md`, `docs/40_ENGINEERING/DEPENDENCIES.md`

### 3-1. 패키지 형상

- 3-1-1. [확정] 패키지 필수 구성: `package.json`, `tsconfig.json`, `index.ts` (패키지 루트)

- 3-1-2. [확정] `index.ts`는 패키지 외부 노출의 유일한 Facade

- 3-1-3. [확정] 패키지 외부에서 import 가능한 경로는 `packages/<pkg>/index.ts` 하나뿐. deep import(`@zipbul/*/src/`) 금지

### 3-2. 의존성 선언

- 3-2-1. [확정] import와 의존성 선언 불일치 금지. 런타임 import → `dependencies`/`peerDependencies` 선언 필수

- 3-2-2. [확정] 워크스페이스 루트 호이스팅에 기대는 선언 누락 금지

- 3-2-3. [확정] `optionalDependencies` 기본 사용 금지

- 3-2-4. [확정] `devDependencies`: 배포 런타임에 절대 필요 없는 항목만

### 3-3. 패키지 간 의존 방향

- 3-3-1. [제외] CLI → 런타임 패키지 의존 금지 — 별도 논의 대상

- 3-3-2. [확정] 런타임 어댑터/플러그인: 코어/공통 패키지는 `peerDependencies`로 선언

- 3-3-3. [확정] public contract에서 의존 타입을 노출하면 `dependencies`/`peerDependencies` 선언 필수

---

## 4. 파일 구조

출처: `docs/40_ENGINEERING/STYLEGUIDE.md`

### 4-1. 파일 명명

- 4-1-1. [확정] 파일명: `kebab-case`. 예약 파일명은 예외: `index.ts`, `types.ts`, `interfaces.ts`, `enums.ts`, `constants.ts`

### 4-2. 타입/인터페이스 분리 (STYLE-005)

- 4-2-1. [확정·반영완료] 2개 이상 파일에서 사용되는 선언 → `types.ts`/`interfaces.ts`/`enums.ts`/`constants.ts`로 분리. 단일 파일 내 사용은 해당 파일에 named type으로 선언

- 4-2-2. [확정·반영완료] feature 폴더 내 `types.ts`, `interfaces.ts`, `enums.ts`, `constants.ts`는 2개 이상 파일에서 사용 시에만 생성

- 4-2-3. [확정·반영완료] 테스트는 별도 규칙 적용

### 4-3. 파일 분해/응집도

- 4-3-1. [확정] 파일 1개는 1문장으로 책임 설명 가능해야 함. "and"로 늘어나면 분해, 빈약하면 합침

- 4-3-2. [확정] 분해 허용 조건: 공개 API 경계 / 독립적 변경 이유 / 테스트 격리 / 순환 참조 차단 / 재사용 경계(2+소비자)

- 4-3-3. [확정] 분해 금지: 무의미한 래핑(thin wrapper) / LOC 절감 목적 / 재사용 근거 없는 `utils.ts`/`helpers.ts`

- 4-3-4. [확정] 마이크로 파일 가드레일: 비테스트 20 LOC 미만 단일 함수/상수 → 기본값은 병합. Public Facade, 공개 API 경계, 테스트 격리, 재사용 경계(2+) 예외만 허용

---

## 5. 네이밍 규칙

출처: `docs/40_ENGINEERING/STYLEGUIDE.md`

- 5-1. [확정] 클래스: `PascalCase`

- 5-2. [확정] 인터페이스: `PascalCase`. `I` 접두사 금지

- 5-3. [확정] 타입: `PascalCase`

- 5-4. [확정] 함수/변수: `camelCase`

- 5-5. [확정] 상수: `SCREAMING_SNAKE_CASE`

- 5-6. [확정] Enum 이름: `PascalCase`

- 5-7. [확정] Enum 항목: `PascalCase`. `SCREAMING_SNAKE_CASE` 금지

- 5-8. [확정] 한 글자 식별자 금지. 예외: 루프 인덱스 `i/j/k`, 미사용 `_`, 범용 제네릭 `T`

- 5-9. [확정] 콜백 파라미터: 자연어 의미명 필수. 예외 없음

- 5-10. [확정] 컬렉션: 복수 명사(`products`). 순회 변수: 단수 명사(`product`). Map: 키 의미 이름(`productsById`)

- 5-11. [확정] 해석 불가능한 약어 금지 (`a`, `b`, `p`, `v` 등). 통용 약어는 허용

---

## 6. 타입 시스템

출처: `docs/40_ENGINEERING/STYLEGUIDE.md`

### 6-1. Type / Interface / Enum 선택 기준

- 6-1-1. [확정] Interface 우선. 기본 선택은 interface

- 6-1-2. [확정] Type: interface 불가 시만 (유니온, 교차, 튜플, 제네릭 discriminated union, 조건부 타입 등)

- 6-1-3. [확정] Enum 적극 사용. 값 그룹핑은 enum. 기본은 문자열 Enum

- 6-1-4. [확정] Union Type: enum 불가 시만 (타입 수준 연산, 제네릭 조합, discriminated union 등)

- 6-1-5. [확정] `as const`: enum 대체 가능하면 금지. enum 불가 시만 허용 (런타임 배열+타입 동시 필요 등)

- 6-1-6. [확정] `const enum` 금지. 일반 enum 적극 사용. Bun 최적화

### 6-2. 타입 안전성

- 6-2-1. [확정] `any`: 절대 표현 불가한 타입인 경우에만 허용. 그 외 금지

- 6-2-2. [확정] `unknown`: 외부 IO 경계에서만 허용. 전파/저장/구조분해 금지. 동일 함수 내 즉시 좁히기 필수

- 6-2-3. [확정] `Record<string, any>` 금지

- 6-2-4. [확정] 인라인 오브젝트 타입 금지. 반드시 named type/interface로 선언

- 6-2-5. [확정] 인라인 함수 시그니처 금지. 콜백/함수 타입은 type으로 별도 정의

- 6-2-6. [확정] 타입 단언(`as`) 금지. `satisfies` 권장

- 6-2-7. [확정] 타입 중복 선언 금지. SSOT 단일 출처 + TypeScript 문법으로 파생. 파생 최대 3단계

- 6-2-8. [확정] 우산 타입(alias) 도입/확산 금지. `AnyValue`, `AnyFunction`, `UnsafeValue`, `UnsafeRecord` 금지

- 6-2-9. [확정] Public/Shared 타입에서 `object`/`Function` 금지

---

## 7. 코드 스타일

출처: `docs/40_ENGINEERING/STYLEGUIDE.md`

### 7-1. 포맷팅

- 7-1-1. [제외] 선언/제어문 사이 빈 줄 강제

- 7-1-2. [제외] Early return 블록 형태 필수

- 7-1-3. [제외] 값-받는 호출과 단순 호출 사이 빈 줄 강제

- 7-1-4. [제외] 로깅 블록 앞/뒤 빈 줄 강제

- 7-1-5. [확정] early return 후 `else` 금지

- 7-1-6. [확정] Shorthand Property 선호. `{ local: localName }` 대신 `{ local }`

- 7-1-7. [확정] 브래킷 표기법 금지. `a['b']` → `a.b`. 동적 키 예외

### 7-2. 값/연산자

- 7-2-1. [확정] `??`/`||`/`? :` 엄격 구분. `??`=null/undefined만, `||`=falsy 전체, `? :`=명시적 분기

- 7-2-2. [확정] `null` vs `undefined` 엄격 구분. `undefined`=없음, `null`=의도적 비어있음

- 7-2-3. [확정] 동일 리터럴 2회+ 사용 시 상수/enum 추출

- 7-2-4. [확정] 그룹 값 → enum, 단일 값 → const. `as const`/`const enum` 금지

- 7-2-5. [확정] 스프레드 연산자 제한. config/options 소형 객체만 허용. 도메인 엔터티/컬렉션/외부 입력에는 금지

### 7-3. 품질

- 7-3-1. [확정] 중복 코드 금지. 재사용 시 즉시 함수/모듈로 단일화

- 7-3-2. [확정] 로컬 상수 금지. `constants.ts` 또는 클래스 프로퍼티로 선언

- 7-3-3. [확정] 불변성: 인자로 받은 객체/배열 변형 금지. `readonly` 사용 권장

- 7-3-4. [확정] Floating Promise 금지. `Promise.all` 사용 시 동시성 제한 고려

- 7-3-5. [확정] Deprecated: 내부 코드 즉시 삭제. Public API `@deprecated`는 사용자 논의 필수

### 7-4. 문서화/주석

- 7-4-1. [확정] Public API TSDoc 필수. `@param`, `@returns`, `@public`, `@example` 등 풍부하게 작성

- 7-4-2. [확정] `// TODO`, `// FIXME` 절대 금지. `eslint-disable`, `@ts-ignore`, `@ts-expect-error` 절대 금지

---

## 8. 함수/메서드 설계

출처: `docs/40_ENGINEERING/STYLEGUIDE.md`

- 8-1. [확정·중복] 모든 함수/메서드는 단일 오퍼레이션만 수행 (→ 4-3-1 SRP과 통합 대상)

- 8-2. [확정] Class 사용 기준 (하나라도 해당 시 class):
  - 인스턴스 생성 + 데코레이터
  - `extends` 필요한 구조적 상속
  - `implements` 필요한 계약 이행
  - 상태 캡슐화 (`private`/`#` 필드)
  - 위 외 모든 경우 → function

- 8-3. [확정] "나중에 확장 가능" 단독 이유로 class 선택 금지

- 8-4. [확정] `private` 메서드: 공개 메서드 1개 보조용. 재사용 시 standalone function으로 승격

- 8-5. [확정] Public Instance Method: 유닛 테스트 용이한 크기로 분해

- 8-6. [확정] Static Method: 기본 금지. Factory 패턴, 클래스 네임스페이스 순수 유틸, 정적 공유 상태에만 예외

- 8-7. [확정] 함수 파라미터 3개 초과 시 interface화
