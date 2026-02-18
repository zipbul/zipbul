# Zipbul 아키텍처 헌법 (Level 2)

> **L2 – Architecture (Structural Boundary)**
>
> 이 문서는 Zipbul 프레임워크의 **구조적 경계**, **허용 가능한 배치(Placement)**, 그리고
> **의존성 방향(Direction)**을 정의하는 최상위 아키텍처 명세서이다.
>
> 본 문서는 **[SSOT_HIERARCHY](../10_FOUNDATION/SSOT_HIERARCHY.md)** 에 따라
> **L1(기술적 불변식)** 을 계승하며,
> L1의 물리 법칙 하에서 시스템이 가질 수 있는 **구조적 형태의 한계**를 규정한다.
>
> 본 문서에서 정의된 규칙은
> 디렉토리 구조, 의존 방향, 계층 간 결합 여부를 기준으로
> **정적 분석 시점에 위반 여부가 판정 가능**해야 한다.
> 판정 불가능한 구조는 허용되지 않는다.

NOTE: 판정 가능성의 구체적 검증 절차는 **[L4/VERIFY.md](../40_ENGINEERING/VERIFY.md)** 가 정의한다.

---

## 1. 지능의 국소성 (Intelligence Locality)

Zipbul 아키텍처의 제1원칙은 **지능의 국소화**이다.
시스템의 모든 구조적 판단은 빌드 타임에 완료되며,
런타임은 이미 확정된 실행 경로만을 따른다.
이는 **L1 Invariants #1 (Platform & Intelligence Locality)** 의 구조적 투영이다.

### 1.1 Exclusive Bun Platform

이 아키텍처는 **Bun 런타임**을 절대 전제로 한다.
Node.js 호환성 유지를 전제로 한 구조는 허용되지 않으며,
모든 구성은 Bun 런타임의 실행 모델을 기준으로 배치되어야 한다.

### 1.2 Build-Time Structural Determination

- **Build-Time Authority:** 구조적 사실(모듈 경계, 의존 관계, 역할)은
  빌드 타임에 정적으로 확정된다.
- **Explicitness Only:** 구조 판정은 오직 **명시적 마커(Explicit Marker)** 와
  파일 시스템 구조에 근거하며,
  추측 기반 판정은 허용되지 않는다.

### 1.3 Runtime Determinism

- **Immutable Execution Engine:** 런타임 실행 엔진은 교체·후킹·변형될 수 없다.
- **Static Context Binding:** 런타임 구성 요소는
  빌드 타임에 확정된 정적 연결 관계만을 따른다.
- **Metadata Volatility:** 구조 판정을 위해 사용된 메타데이터는
  부트스트랩 이후 실행 경로에 영향을 미칠 수 없다.

---

## 2. 경로 정체성과 모듈성 (Path Identity & Modularity)

시스템의 모든 정체성과 경계는
파일 시스템의 **물리적 구조**를 기준으로 결정된다.
이는 **L1 Invariants #2 (Structural & Discovery Invariants)** 를 따른다.

### 2.1 Directory-First Modularity

- 모듈의 경계는 디렉토리 구조로만 정의된다.
- 별도의 런타임 모듈 등록 메커니즘은 존재하지 않는다.

### 2.2 Static Wiring

- 표준 `import` 구문은 곧 의존성 선언이다.
- 모든 의존성 그래프는 빌드 타임에 정적으로 확정되어야 한다.

### 2.3 Normalized Path Identity

- 모든 모듈과 컴포넌트의 정체성은
  **정규화된 파일 경로**로만 식별된다.
- 경로 별칭이나 심볼릭 링크를 통한 우회는 허용되지 않는다.

### 2.4 Visibility Barrier

- 모듈 경계는 가시성 장벽으로 작동한다.
- 내부 전용 구성 요소는
  구조적으로 외부 모듈에서 접근할 수 없어야 한다.

---

## 3. 계층적 격리 (Layered Quarantine)

시스템은 역할과 책임의 지속 시간에 따라
명확한 계층으로 분리된다.
이는 **L1 Invariants #3 (Decoupling & Agnosticism)** 의 구조적 구현이다.

- **Protocol-Agnostic Core:** 코어는 프로토콜의 존재를 인지하지 않는다.
- **Adapter Dependency Declaration:** 본 아키텍처가 허용하는 범위 내에서
  어댑터 간 의존은 허용되며, 그 관계는 반드시 **정적이며 명시적으로 선언된 구조**여야 한다.
  런타임 탐색·추론·자동 결합에 기반한 의존은 허용되지 않는다.
  의존 어댑터는 대상 어댑터의 **공개된 Public API**를 통해서만 상호작용할 수 있으며,
  내부 구현 경로 또는 비공개 심볼에 대한 직접 접근은 허용되지 않는다.
  해당 Public API는 대상 어댑터의 패키지 외부로 노출된 단일 진입점(Facade)에 한정된다.
- **Pure Contract Layer:** 계약 계층은
  실행 로직을 포함하지 않는 순수 정의 집합이다.
- **Provider Boundary:** 외부 의존성은
  구조적으로 격리된 경계를 통해 코어와 연결된다.

---

## 4. 어댑터 주권과 파이프라인 (Adapter Sovereignty & Pipeline)

어댑터는 자신의 프로토콜 범위 내 실행 흐름을 소유한다.
단, 그 흐름은 사전에 정의된 구조적 경계를 벗어날 수 없다.

### 4.1 Pipeline Ownership

- 실행 순서는 어댑터 단위로 독립적으로 결정된다.
- 서로 다른 어댑터의 파이프라인은 구조적으로 분리된다.

### 4.2 Static Capability Determination

- 어댑터의 기능적 범위는 빌드 타임에 판정 가능해야 한다.
- 런타임 동적 확장은 구조적으로 허용되지 않는다.

### 4.3 Response Boundary

- 도메인 결과와 프로토콜 응답 사이의 변환은
  어댑터 경계에서만 수행된다.
- 코어는 응답 형식에 관여하지 않는다.

---

## 5. 데이터 무결성 경계 (Data Integrity Boundary)

코어는 입력이 “변환/검증 완료”라고 가정하지 않는다.
변환(transform) 및 검증(validate)의 실행 여부는 어댑터가 선언한 Pipeline의 Pipe 구성에 의해 결정되며,
파이프에 명시적으로 등록되지 않은 변환/검증은 암묵적으로 삽입되거나 추론될 수 없다.
이는 **L1 Invariants #5 (Data & Flow Invariants)** 의 No Implicit Pipe 및 Raw Input Is First-Class를 따른다.

- 변환/검증을 적용하려면 Pipe에 명시적으로 등록되어야 한다.
- Raw Input 모드에서는 변환/검증 이전의 입력이 핸들러로 전달될 수 있다.
- 코어는 Raw Input을 처리하더라도 프로토콜 종속 입력/출력 표현을 전제로 하지 않는다. (Protocol-Agnostic Core)

---

## 6. 결정론적 라이프사이클 (Deterministic Lifecycle)

자원의 초기화와 해제는
의존성 위계를 기준으로 결정론적으로 수행된다.

- **Lifecycle Acyclicity:** 초기화·종료·자원 관리 순서를 결정할 수 없게 만드는
  **라이프사이클 수준의 순환 의존성**은 허용되지 않는다.
- 자원 해제는 의존성 그래프의 역순으로 수행되어야 한다.

---

## 7. 실패 처리의 구조 (Failure Boundary)

실패는 구조적으로 구분된 경로를 따른다.
이는 **L1 Invariants #6 (Defense & Failure)** 의 구조적 반영이다.

- 도메인 실패는 정상 실행 흐름의 일부로 취급된다.
- 시스템 오류는 단일화된 필터 경계를 통해 처리된다.
- 구조 외부에서의 임의적 예외 처리 경로는 허용되지 않는다.

---

## 8. 실행 환경과 구조 분리 (Execution Environment Boundary)

실행 환경 구성은 비즈니스 구조와 분리된 **외부 실행 조건**으로 취급된다.

실행 단위의 배치, 워커 수, 클러스터 형태는
구조적 경계를 정의하거나 변경하는 요소가 아니다.
구조적 의존 관계를 침범하지 않는 한,
실행 토폴로지는 아키텍처 외부에서 결정될 수 있다.

---

## 9. 설정의 구조적 지위 (Configuration Boundary)

설정은 애플리케이션 실행의 전제 조건이며,
구조적으로 불변이다.

- 설정은 실행 이전에 확정되어야 한다.
- 런타임 중 설정 변경을 전제로 한 구조는 허용되지 않는다.

---

## 10. 환경 분리 원칙 (Environment Separation)

> 본 섹션은 환경 차이가 구조적 경계나 의존 규칙을
> 변경하는 근거로 사용되는 것을 방지하기 위한
> 구조적 불변성 선언이다.

개발 환경과 배포 환경은 서로 다른 목적을 가질 수 있으나,
아키텍처가 정의한 구조적 경계와 의존 규칙은
환경에 따라 달라질 수 없다.

환경별 차이는 구조 정의가 아닌,
구조 외부의 설정 또는 도구 계층에서 해소되어야 한다.
