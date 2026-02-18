# TESTING

## 1. 개요 및 원칙 (Overview & Principles)

이 문서는 **Zipbul** 프로젝트의 테스트 작성, 유지보수, 실행에 관한 **단일 진실 공급원(Single Source of Truth, SSOT)**이다.
본 문서에 기술된 규칙은 권장 사항이 아니며, 모든 기여자(Human/Agent)가 준수해야 할 **강제적 규범**이다.

### 1.1 핵심 철학 (Core Philosophy)

1. **신뢰성 (Reliability)**: 테스트는 거짓 양성(False Positive)이나 거짓 음성(False Negative) 없이 코드의 상태를 정확히 반영해야 한다. "가끔 실패하는(Flaky)" 테스트는 즉시 삭제하거나 수정해야 한다.
2. **격리성 (Isolation)**: 각 테스트 케이스는 독립적이어야 하며, 실행 순서나 타 테스트의 상태 변경에 영향을 받아서는 안 된다.
3. **결정성 (Determinism)**: 동일한 코드와 동일한 입력에 대해서는 언제, 어디서 실행하든 100% 동일한 결과가 보장되어야 한다.
4. **속도 (Speed)**: 테스트 스위트는 개발 루프의 일부다. 느린 테스트(특히 유닛 테스트)는 개발 생산성을 저해하므로 최적화되어야 한다.
5. **목적성 (Purpose)**: 테스트를 통과하기 위한 테스트 코드는 작성하지 않는다. 실제 비즈니스 로직과 요구사항을 검증하기 위한 코드를 작성한다.

### 1.2 Hermetic Test Rule (외부 세계 차단 원칙)

모든 테스트는 기본적으로 **Hermetic(외부 세계로부터 완전히 격리된 상태)** 로 실행되어야 한다.

#### 기본 금지 사항 (Unit / Integration 공통)

- 실제 네트워크 호출 (HTTP, WS, TCP 등)
- 실제 파일 시스템 I/O (예: 런타임 `fs` 읽기/쓰기, 임시 파일 생성)
- 실제 시간 의존 (`Date.now()`, `setTimeout` 기반 대기)
- 비결정적 랜덤 값 사용
- 테스트 간 공유되는 전역 상태 변경

#### 예외 허용 범위

- **Integration Test**: 명시적으로 준비된 로컬 인프라(DB, Redis 등)만 허용

위 규칙을 위반하는 테스트는 **구조적으로 잘못된 테스트**로 간주한다.

### 1.3 Contract-First Testing (계약 우선 원칙)

테스트는 현재 구현(implementation)을 설명하는 문서가 아니라,
시스템이 만족해야 하는 계약(contract)을 고정하는 장치다.

- 작성된 코드에 맞춰 테스트를 작성하지 않는다.
- 입력(input)에 대한 기대 결과(expected output)를 테스트 코드로 먼저 고정하고, 소스 코드는 그 기대 결과를 만족하도록 수정한다.
- 리팩터링은 계약을 변경하지 않는다. 리팩터링으로 테스트가 깨진다면, 테스트가 구현 세부사항에 과도하게 결합되어 있는지 먼저 점검한다.
- 로직 변경으로 기대 결과가 달라져야 한다면, 먼저 입력과 기대 결과를 다시 확정한 뒤(요구사항/계약을 명시), 그 계약을 기준으로 테스트와 소스 코드를 함께 정렬한다.

요약하면, 테스트는 계약이 유지되는 한 불변이며,
계약이 변경/명확화되면 테스트는 그 계약을 반영하도록 업데이트되어야 한다.

---

## 2. 테스트 환경 및 실행 (Environment & Execution)

### 2.1 테스트 러너 (Test Runner)

- **Bun Test**: 프로젝트는 `bun test`를 표준 러너로 사용한다. Jest, Mocha 등 타 러너 사용은 금지한다.
- **실행 명령어**:
  - 전체 테스트: `bun test`
  - 커버리지 측정: `bun test --coverage`
  - 특정 파일 실행: `bun test <file-path>`

### 2.2 라이프사이클 훅 (Lifecycle Hooks)

Bun Test가 제공하는 표준 훅을 최대한 활용하여 테스트 전후 상태를 관리한다.

- `beforeAll(() => { ... })`: 테스트 파일(Suite) 전체 실행 전 1회 수행 (DB 연결, 서버 시작 등).
- `afterAll(() => { ... })`: 테스트 파일 전체 실행 후 1회 수행 (DB 연결 해제, 파일 정리 등).
- `beforeEach(() => { ... })`: 각 `it` 실행 직전 수행 (상태 초기화, Mock 리셋).
- `afterEach(() => { ... })`: 각 `it` 실행 직후 수행 (임시 데이터 삭제 등).

### 2.3 Determinism Controls (결정성 보장 규칙)

모든 테스트는 **동일한 입력 → 동일한 결과**를 보장해야 한다.

#### 필수 규칙

- 시간은 테스트 시작 시점에 고정되어야 한다.
- 랜덤 값은 고정 시드 기반으로 생성되어야 한다.
- 타이머 기반 대기는 허용되지 않는다. (가상 타이머 또는 명시적 트리거 사용)
- 테스트 실행 중 환경 변수 변경은 금지된다.

결정성을 훼손하는 테스트는 재현 불가능한 테스트로 간주하며 허용되지 않는다.

#### 실무 가이드 (권장 패턴)

- 시간 의존이 있는 SUT는 `Date.now()`를 직접 호출하지 말고, Clock 의존성을 주입(인자/생성자/DI)하여 테스트에서 고정 값을 제공한다.
- 랜덤 의존이 있는 SUT는 `Math.random()`에 직접 의존하지 말고, 시드 기반 생성기를 주입하여 테스트에서 동일 시드를 사용한다.
- 전역 상태(싱글톤, 캐시, 환경 변수)에 의존하는 경우, 테스트가 직접 조작하기보다 의존성 주입/초기화 경계로 이동시켜 격리한다.

---

## 3. 테스트 계층 구조 (Test Pyramid)

|계층|파일 패턴|위치|목적|Mocking 전략|
|:--|:--|:--|:--|:--|
|**Unit**|`*.spec.ts`|소스 코드와 동일 위치 (Colocated)|단일 함수/클래스의 로직 검증|**Strict Mocking** (외부 의존성 전면 차단)|
|**Integration**|`*.test.ts`|`test/integration/` (패키지 루트 또는 레포 루트)|모듈 간 상호작용 및 파이프라인 검증|3rd Party API만 Mocking (DB는 실제/인메모리 사용)|

### 3.1 Test Case Coverage Model (Mandatory)

모든 테스트 대상은 아래 3가지 범주의 케이스를
**명시적으로 고려하고, 가능한 경우 테스트로 구현해야 한다.**

1. **Happy Path**
   - 정상 입력과 정상 조건에서의 기대 동작
   - 최소 1개 이상 필수

2. **Negative Path (Non-Happy Path)**
   - 잘못된 입력, 누락된 값, 비즈니스 규칙 위반
   - 실패는 Result 또는 명시적 오류로 검증한다.

3. **Edge Case**
   - 경계값, 극단값, 희귀하지만 가능한 조건
   - 입력 범위나 제약이 존재하는 경우 필수 포함

Happy Path만 검증하는 테스트는
**테스트 대상의 신뢰성을 보장하지 못하므로 불완전한 테스트**로 간주한다.

### 3.2 Monorepo Test Layout (Hybrid)

이 저장소는 Monorepo이므로 테스트 자산은 아래 2가지 루트로 분리된다.

- 패키지 로컬: 각 패키지가 독립적으로 유지되기 위해 필요한 테스트 자산은 패키지 루트의 `test/` 아래에 둔다.
- 레포 루트: 여러 패키지를 가로지르는 공통 규격/공유 인프라 모킹/오케스트레이션은 레포 루트의 `test/` 아래에 둔다.

패키지 내부 코드는 레포 루트 `test/`를 참조하지 않는 것을 기본값으로 둔다.

표준 배치(요약):

```text
<repo-root>/
├── packages/
│   └── <pkg>/
│       ├── src/
│       │   └── <dir>/
│       │       ├── <file>.ts
│       │       ├── <file>.spec.ts
│       │       └── test/                # src-local test assets
│       │           ├── interfaces.ts
│       │           ├── types.ts
│       │           ├── constants.ts
│       │           ├── stubs.ts
│       │           ├── fixtures.ts
│       │           ├── factories.ts
│       │           ├── helpers.ts
│       │           └── utils.ts
│       └── test/
│           ├── shared/
│           │   ├── types/
│           │   ├── factories/
│           │   └── stubs/
│           └── integration/
│               └── <domain>/
│                   ├── <case>.test.ts
│                   └── <flow>.test.ts
└── test/                                # repo-root test kernel & cross-package verification
    ├── setup.ts
    ├── matchers/
    │   ├── index.ts
    │   └── *.matcher.ts
    ├── shared/
    │   └── types/
    ├── fixtures/
    └── mocks/
```

---

## 4. 상세 작성 규칙 (Detailed Guidelines)

### 4.1 Describe / It Structure Rules (Mandatory)

#### Unit Test Structure Rules (MUST)

- describe 1-depth는 **테스트 대상(SUT)의 식별자**여야 한다(MUST).
  - 함수/모듈 테스트: 함수명 또는 모듈명
  - 클래스 테스트: 클래스명
- Unit Test에서 depth 구성은 아래 2가지 형태만 허용한다(MUST).
  - 형태 A (단일 함수/단일 모듈):
    - 1-depth: SUT 식별자
    - 2-depth(선택): SUT의 하위 기능 단위(메서드명 또는 논리적 하위 구역)
    - it: 단일 케이스
  - 형태 B (클래스 + 메서드 단위):
    - 1-depth: 클래스명
    - 2-depth: 메서드명
    - 3-depth(선택): SUT의 하위 기능 단위(메서드명 또는 논리적 하위 구역)
    - it: 단일 케이스
- it은 **단 하나의 케이스만** 검증해야 한다(MUST).
  - 하나의 성공, 하나의 실패, 하나의 엣지 케이스는 각각 별도의 it로 분리한다.
- 논리적으로 묶을 수 있는 케이스만 describe로 그룹핑한다(MUST).
- Private 함수도 테스트 대상이 될 수 있다(MAY).
  - 단, 해당 테스트는 내부 로직의 안정성을 검증하기 위한 목적이어야 한다.

- 조건/상황/맥락은 it 제목(BDD 문장)에 포함하는 것을 기본값으로 한다(5.1).
- describe는 SUT 식별 및 (필요한 경우에 한해) 메서드 단위 그룹핑까지만 사용한다.

#### Context Grouping Rules (MUST)

- Unit Test에서 describe 제목이 "when "으로 시작하는 것을 금지한다(MUST NOT).
  - 위반 판정: 동일 테스트 파일에서 describe 제목(인자 문자열)이 "when "으로 시작하면 위반
  - 대체: it 제목을 BDD 문장으로 작성하고, "when ..."은 it 제목에 포함한다(5.1).

#### External Call Isolation Rule (Unit Test MUST)

Unit Test에서 테스트 대상 함수(SUT)가 내부적으로 호출하는
**모든 외부 함수 / 클래스 / 모듈 호출은 반드시 Mock 또는 Spy 처리해야 한다.**

- Spy 사용 범위는 4.2 정책을 따른다.

- 테스트 대상이 아닌 함수의 실제 구현을 실행하는 것은 금지한다.
- 동일 파일 내 helper라도 테스트 대상이 아니라면 Mock 대상이 될 수 있다.
- 단, 순수 데이터 객체(DTO, Value Object)는 예외로 허용한다.

이 규칙을 위반한 테스트는
Unit Test가 아닌 **암묵적 Integration Test**로 간주하며 허용되지 않는다.

#### Integration Structure Rules (MUST)

- `describe` 1-depth는 **주제 또는 사용자 관점의 기능 단위**여야 한다.
- `describe` 2-depth는 **옵션, 분기, 환경 차이**를 표현할 때만 사용한다.
- `it`은 반드시 **단일 시나리오 / 단일 기대 결과**만을 가진다.

이 구조를 위반한 테스트는
의도를 판정할 수 없으므로 **구조적으로 잘못된 테스트**로 간주한다.

### 4.2 Test Doubles Policy (Mock / Stub / Spy)

테스트 더블(Test Double)은 목적에 따라 명확히 구분하여 사용해야 한다.
의미가 다른 더블을 혼용하는 테스트는 의도를 흐리며 유지보수를 어렵게 한다.

- **Mock**: 호출 여부와 호출 횟수, 인자를 검증하기 위한 더블
  - 행위(Behavior)를 검증할 때 사용한다.
- **Stub**: 미리 정의된 값을 반환하기 위한 더블
  - 상태(State)를 만들기 위한 용도로만 사용한다.
- **Spy**: 실제 구현을 유지하되 호출 정보만 관찰하는 더블
  - 레거시 코드 또는 점진적 테스트 보강 시에만 제한적으로 허용한다.

### 금지 규칙

- 하나의 테스트에서 Mock과 Stub의 역할을 혼용하지 않는다.
- Unit Test에서 Spy 사용은 원칙적으로 지양하며, 필요 시 제한적으로 허용한다.
- 테스트 목적 없이 습관적으로 Mock을 생성하지 않는다.

### 4.3 유닛 테스트 (Unit Tests)

- **범위**: 테스트 대상(SUT)은 오직 하나의 함수나 클래스여야 한다.
- **Strict Mocking**: SUT 내부에서 호출되는 **모든** 외부 의존성(다른 클래스, 모듈, 네트워크, DB 등)은 반드시 `mock` 또는 `spyOn`을 사용하여 격리해야 한다. 실제 구현체를 주입하는 것은 금지된다 (DTO/Value Object 제외).
- **White-box Testing**: 내부 로직 분기를 검증하기 위해 내부 상태에 접근하는 것이 허용되나, 가능한 공개 인터페이스를 통해 검증하는 것을 권장한다.

#### Unit Test Isolation Rule (Dependency Handling)

Unit Test는 테스트 대상의 동작을 격리하기 위해, 아래 경계를 반드시 지킨다.

- 네트워크/DB/파일/시간/랜덤 등 **I/O 경계**는 항상 Mock/Stub로 대체한다.
- 테스트 대상이 의존하는 외부 모듈(다른 패키지, 다른 서비스, 외부 라이브러리)은 기본적으로 Mock/Stub 처리한다.
- 동일 모듈 내 순수 helper는 Mock 강제 대상이 아니며, 테스트 목적을 흐리는 경우에만 제한적으로 대체한다.
- Spy는 관찰 목적에 한해 제한적으로 허용한다. (행위 검증이 목적일 때에만)

### 4.4 통합 테스트 (Integration Tests)

- **Public API Testing**: 모듈의 내부 구현(private method)을 직접 호출하지 않는다. 반드시 모듈의 **Public API**를 통해서만 상호작용한다.
  - _규칙_: 테스트 시나리오 검증에 필요한 Public API가 없다면, `test-only` 메서드를 뚫는 대신 모듈 설계를 재검토하여 정당한 Public API를 보강해야 한다.
- **디렉토리 구조**: 테스트 파일이 비대해지거나 도메인이 복잡할 경우, 단일 파일 대신 디렉토리로 묶는다.
  - 예: `test/integration/orders/create-order.test.ts`, `test/integration/orders/cancel-order.test.ts`

#### Integration Mocking Boundary

Integration Test는 내부 경계 간 결합을 검증한다.
따라서 도메인/코어/어댑터 내부 결합은 실제 구현을 사용한다.

- 외부 SaaS/외부 API/결제/메일/SMS 등 통제 불가능한 의존성은 Mock/Stub로 대체한다.
- 로컬에서 재현 가능한 인프라(DB, Redis 등)는 실제 인스턴스 사용을 허용한다.

## 5. 코딩 표준 및 스타일 (Coding Standards)

### 5.1 네이밍 컨벤션 (Naming - BDD Style)

- **describe**: 테스트 대상(Class, Module) 또는 기능(Method)의 이름을 명확히 기술한다. 중첩은 4.1에서 허용한 형태 내에서만 사용한다.
- **it**: 반드시 **BDD 스타일**(`should ... when ...`)을 따른다. "테스트가 무엇을 검증하는지"가 아니라 "시스템이 어떻게 행동해야 하는지"를 서술한다.
  - ✅ `it("should return 200 OK when the payload is valid", ...)`
  - ✅ `it("should throw ValidationError when email is missing", ...)`
  - ❌ `it("test create user", ...)`
  - ❌ `it("works", ...)`

### 5.2 코드 구조 (AAA Pattern)

모든 테스트 케이스 내부는 **AAA (Arrange, Act, Assert)** 패턴을 명시적으로 준수해야 한다. 가독성을 위해 빈 줄로 단계를 구분한다.

```typescript
describe('UserService', () => {
  describe('createUser', () => {
    it('should return the created user when input is valid', async () => {
      // Arrange (준비: 데이터 생성, Mock 설정)
      const input = { name: 'Alice' };
      mockRepo.save.mockResolvedValue({ id: 1, ...input });

      // Act (실행: SUT 호출)
      const result = await userService.createUser(input);

      // Assert (검증: 결과 확인)
      expect(result).toEqual({ id: 1, name: 'Alice' });
      expect(mockRepo.save).toHaveBeenCalledTimes(1);
    });
  });
});
```

### 5.3 데이터셋 및 Fixture 관리 (Datasets & Stubs)

- **하드코딩 지양**: 반복되는 테스트 데이터는 별도 파일로 분리한다.
- **Fixtures**: 정적인 데이터셋(JSON 등)은 `test/fixtures/` 디렉토리에 위치시킨다.
  - Unit Test에서는 런타임 파일 I/O에 의존하지 않도록, 모듈 import 등 결정적인 로딩 방식만 사용한다.
- **Stubs**: 테스트 더블로 사용하는 스텁 데이터/오브젝트/함수는 `packages/<pkg>/src/<dir>/test/stubs.ts` 또는 `packages/<pkg>/test/shared/stubs/`에 위치시킨다.
- **Factories**: 동적인 데이터 생성이 필요한 경우, `packages/<pkg>/src/<dir>/test/factories.ts` 또는 `packages/<pkg>/test/shared/factories/`에 작성하여 활용한다. (예: `createUserParams()`)

Monorepo에서 위 `test/` 경로는 다음 중 하나를 의미할 수 있다.

- 레포 루트 `test/`
- 패키지 루트 `packages/<pkg>/test/`

### 5.4 헬퍼 및 유틸리티 (Helpers & Utils)

- **전역 헬퍼**: 모든 테스트에서 공통으로 사용되는 유틸리티(예: `mockLogger`, `createTestApp`)는 `packages/<pkg>/src/<dir>/test/helpers.ts` 또는 `packages/<pkg>/test/shared/`에 작성한다.
- **지역 헬퍼**: 특정 도메인에만 한정된 헬퍼는 해당 테스트 파일과 인접한 `__test_utils__` 디렉토리나 파일 내부에 작성한다.

Monorepo에서 전역 헬퍼의 기준은 아래와 같이 해석한다.

- 패키지 로컬 전역 헬퍼: `packages/<pkg>/test/shared/`
- 레포 루트 전역 헬퍼: `test/`

Monorepo에서 전역 타입/매처/인프라 모킹은 아래 위치를 기준으로 한다.

- 전역 타입: `test/shared/types/` (패키지 로컬이면 `packages/<pkg>/test/shared/types/`)
- 전역 매처: `test/matchers/`
- 인프라 모킹: `test/mocks/`

본 문서는 TestContainer를 표준 테스트 유틸리티로 정의하지 않는다.

### 5.5 Assertion Rules (One It = One Reason) (MUST)

- 하나의 `it` 블록은 **하나의 실패 이유(Reason to Fail)** 만을 가져야 한다.
- 여러 개의 `expect`는 허용되나,
  반드시 **동일한 논리적 결과**를 검증해야 한다.
- 서로 다른 분기, 성공/실패를 하나의 `it`에 결합하는 것을 금지한다.

이 규칙을 위반한 테스트는
실패 원인을 판정할 수 없으므로 구조적으로 잘못된 테스트다.

---

## 6. 안티 패턴 (Anti-Patterns)

1. **Logic in Tests**: 테스트 코드 내에 복잡한 조건문(`if`, `for`)이나 로직을 작성하지 않는다. 테스트는 선언적이어야 한다.
2. **Implementation Leaking**: 프로덕션 코드를 수정할 때 테스트 코드도 함께 수정해야 한다면(깨진 테스트 복구 제외), 테스트가 구현 세부사항에 너무 의존하고 있다는 신호다.
3. **Catching Everything**: `try-catch`로 예외를 잡고 `expect` 없이 넘어가는 행위를 금지한다. 예외 검증은 `expect(() => ...).toThrow()`를 사용한다.
4. **Flaky Tests**: 네트워크 지연이나 실행 순서에 따라 결과가 달라지는 테스트를 방치하지 않는다.
5. **Uncontrolled Snapshot Tests**
   - 의미 없는 대형 객체 스냅샷을 금지한다.
   - Snapshot은 UI 출력 또는 명확한 직렬화 결과에만 제한적으로 사용한다.
   - Snapshot 변경을 무비판적으로 승인하는 행위는 테스트 무효화로 간주한다.

6. **Code-Driven Expectation Change**

    - 실패한 테스트를 “현재 코드가 하는 대로” 통과시키기 위해 기대 결과(expected output)를 조정하는 것을 금지한다.
    - 기대 결과 변경이 필요하다면, 먼저 입력과 기대 결과(계약)를 명시적으로 확정한 뒤 그 계약을 기준으로 변경한다.

### 6.1 Failure Message Quality

테스트 실패 메시지는 디버깅 가능한 정보를 제공해야 한다.

- 단순한 `toBe(true)` / `toBe(false)` 사용을 지양한다.
- 의미 있는 값 비교 또는 커스텀 메시지를 사용한다.
- 실패 로그만 보고도 원인을 추론할 수 있어야 한다.

테스트 실패 메시지가 의미를 전달하지 못한다면,
그 테스트는 구조적으로 불완전하다.

### Optional Policy: Internal Logic Testing (Non-SSOT)

원칙적으로 테스트는 Public behavior(공개된 계약)를 대상으로 한다.
Internal/private 구현 상세에 직접 결합하는 테스트는 리팩터링 내성을 훼손할 수 있다.

단, 아래 조건을 모두 만족하는 경우에 한해 내부 로직 테스트를 허용할 수 있다.

- 순수 함수(부수효과 없음)이며
- 복잡도가 높아 단위로 검증할 필요가 있고
- 테스트가 외부 공개 계약을 우회하지 않으며
- 접근 방식이 구조적 경계를 침범하지 않는다

본 섹션은 권장 사항이며, 구조 판정의 근거(SSOT)는 아니다.

---

## 7. 체크리스트 (Self-Check)

- [ ] 파일명 규칙(`*.spec.ts`, `*.test.ts`)을 준수했는가?
- [ ] `describe`와 `it` 네이밍이 BDD 스타일인가?
- [ ] AAA 패턴으로 구조가 명확한가?
- [ ] 유닛 테스트에서 외부 의존성을 모두 Mocking 했는가?
- [ ] 통합 테스트에서 Public API만을 사용했는가?
- [ ] 반복되는 데이터나 로직을 Fixture/Helper로 분리했는가?
- [ ] 실패한 테스트를 코드에 맞추어 통과시키지 않았는가? (계약을 먼저 확정했는가?)
- [ ] 기대 결과가 구현 세부사항(문자열/호출 순서/내부 구조)에 과결합되어 있지 않은가?
- [ ] `bun test` 실행 시 경고나 에러 없이 통과하는가?

---

## 8. Mechanical Enforcement (Rule Blocks)

이 섹션은 **기계 판정(Decidable)** 가능한 규칙만을 포함한다.
아래 Rule Block은 문서 내 다른 서술(설명/예시)보다 우선하여 집행 기준으로 사용된다.

```text
Rule: TST-UNIT-MAP-001
Target: **/*.spec.ts
Violation: `**/<dir>/<name>.spec.ts`가 존재하지만, 동시에 `**/<dir>/<name>.ts`가 존재하지 않음
Enforcement: block
```

```text
Rule: TST-UNIT-MAP-002
Target: **/*
Violation: 아래 조건 중 하나라도 true
  - (디렉토리-완결성) 어떤 디렉토리 `<dir>`에 `*.spec.ts`가 1개 이상 존재하고, 동시에 아래 조건을 만족하는 파일 `**/<dir>/<name>.ts`가 존재함
      - `**/<dir>/<name>.ts`는 `*.d.ts` / `*.spec.ts` / `*.test.ts`가 아님
      - 동시에 `**/<dir>/<name>.spec.ts`가 존재하지 않음
Enforcement: block
```
