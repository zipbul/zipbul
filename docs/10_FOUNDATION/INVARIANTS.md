# INVARIANTS: Zipbul의 절대 헌법 (L1)

> **L1 – Foundation (Technical Invariants)**
>
> 이 문서는 Zipbul 프로젝트의 **최상위 기술 불변식**을 정의하는 정본(SSOT)이다.
> 본 문서의 규칙은 설계 선택의 대상이 아니며, 시스템의 존재를 규정하는 물리 법칙이다.
> 위반은 논의 없이 즉시 중단(Immediate Stop) 대상이다.

---

## 1. Platform & Intelligence Locality

- **Exclusive Bun:** Zipbul는 **Bun 런타임 이외의 환경에서 동작하는 것을 전제로 하지 않는다.** Node.js 호환성 유지를 위한 타협적 코드는 존재할 수 없다.
- **Intelligence at Build-Time:** 프레임워크의 모든 추론과 판단(지능)은 **빌드 타임(CLI)에 완결된다.** 런타임이 스스로의 구조를 분석하거나 판단하는 지능적 경로는 **존재하지 않는다.**
- **Immutable Engine:** 프레임워크의 핵심 실행 엔진은 사용자에 의해 **교체되거나 변형될 수 없다.** 엔진의 실행 메커니즘을 런타임에 후킹하거나 오버라이딩하는 행위는 허용되지 않는다.
- **No Runtime Reflection:** `reflect-metadata`를 포함하여, 런타임에 심볼의 의미를 탐색하거나 타입 정보를 추론하는 모든 행위는 **절대 금지된다.**

---

## 2. Structural & Discovery Invariants

- **Directory-First Modularity:** 모듈의 경계는 오직 **파일 시스템 디렉토리 구조**에 의해 정적으로 결정된다. 런타임에 모듈 관계를 동적으로 등록하거나 재구성하는 메커니즘은 존재하지 않는다.
- **Path-Based Identification:** 모든 컴포넌트와 모듈의 유일성(Identity)은 **정규화된 파일 경로**로만 결정된다. 별칭(Alias)이나 런타임 우회 경로는 존재하지 않는다.
- **Marker-Based Role Identification:** 컴포넌트의 역할은 소스 코드에 기록된 **명시적 마커(Explicit Marker)**로만 식별된다. 마커 없는 추측 기반의 역할 판정은 허용되지 않는다.
- **Explicitness Over Guesses:** CLI는 구조적 모호함 발견 시 추측하지 않고 **빌드를 즉시 중단한다.** 보정이나 추측 기반의 처리는 존재하지 않는다.

---

## 3. Decoupling & Agnosticism Invariants

- **Protocol-Agnostic Core:** 비즈니스 코어 로직은 자신이 어떤 프로토콜(HTTP, WS 등) 위에서 구동되는지 **인지할 수 없다.** 프로토콜 종속적인 정보가 코어에 유출되는 모델은 허용되지 않는다.
- **Adapter Isolation:** 어댑터 간의 직접적인 상호 인지나 의존 관계는
  **암묵적·동적·추론 기반으로 생성될 수 없다.**
  어댑터 간 의존이 존재하는 경우, 그 관계는 반드시
  **빌드 타임에 정적으로 선언된 구조**여야 하며,
  런타임 탐색이나 자동 결합 메커니즘은 존재하지 않는다.
  의존 어댑터는 상대 어댑터의 내부 구현에 직접 접근하거나
  상대가 제공한 **명시적으로 선언된 결합 경계**를 통해서만 결합할 수 있다.
- **Declarative Contract Purity:** 계약 계층은 오직 타입과 마커만을 포함하며, **어떠한 실행 로직이나 환경 의존성도 가지지 않는다.**

---

## 4. Immutability & Volatility Invariants

- **Deterministic Execution Path:** 모든 실행 경로는 애플리케이션 시작 시점에 **함수 호출 체인으로 확정**되어야 한다. 런타임에 실행 노드나 순서를 변경하는 동적 파이프라인은 존재하지 않는다.
- **Metadata Volatility:** 부트스트랩 완료 이후, 시스템 설계를 설명하기 위한 모든 메타데이터(설계도)는 **메모리에서 즉시 소거(Cleanup)된다.** 실행 중 설계 정보에 접근하는 경로는 존재하지 않는다.
- **Static DI Wiring:** 의존성 주입은 빌드 타임에 확정된 **정적 팩토리 호출**로 변환된다. 런타임에 의존성을 탐색하거나 해결하는 IoC 컨테이너는 존재하지 않는다.
- **Reverse-Order Disposal:** 시스템 종료 시 리소스 해제는 반드시 **의존성 그래프의 역순**으로 수행되어야 한다. 순서가 보장되지 않는 자원 해제 모델은 허용되지 않는다.

---

## 5. Data & Flow Invariants

- **Anemic Data Model:** 데이터 컨테이너(DTO, Entity)는 비즈니스 로직이나 행위를 포함하지 않는 **순수 데이터 객체(Plain Data)**여야 한다. 데이터 객체가 스스로 상태 전이를 제어하는 모델은 허용되지 않는다.
- **Strict Execution Context:** 실행 컨텍스트(Context) 정보는 빌드 타임에 정적으로 주입되어야 하며, **런타임 스택 트레이스 분석(Introspection)을 통해 생성되는 경로는 존재하지 않는다.**
- **Result-First Domain Success:** 비즈니스 실패는 예외(throw)가 아닌 **Result 컨테이너**를 통해서만 표현된다. 도메인 실패를 예외 경로로 처리하는 흐름은 존재하지 않는다.
- **No Implicit Pipe:** 변환(transform) 및 검증(validate)은 **파이프(Pipe)에 명시적으로 등록된 경우에만** 실행되어야 한다. 등록되지 않은 변환/검증을 프레임워크 또는 어댑터가 암묵적으로 삽입하거나 추론하는 경로는 존재하지 않는다.
- **Raw Input Is First-Class:** 사용자는 입력을 raw로 취급하고, raw를 그대로 핸들러로 전달하는 실행 구성을 선택할 수 있어야 한다. 프레임워크는 핸들러 입력이 “이미 변환/검증 완료된 DTO”라고 가정해서는 안 된다.

---

## 6. Defense & Failure Invariants

- **Fail-Fast Startup:** 부적절한 설정이나 구조적 결함이 있는 상태에서 시스템이 기동되는 경우는 **절대 존재하지 않는다.** 모든 미충족 조건은 시작 단계에서 프로세스 즉시 종료로 이어진다.
- **Unified Exception Filter:** 예외 처리는 오직 **단일화된 필터 체인**을 통해서만 수행된다. 필터 체인을 우회하거나 독립적인 예외 처리 경로를 생산하는 행위는 허용되지 않는다.
- **No Manual Try-Catch for Infrastructure:** 사용자는 실행 인프라(파이프라인)의 제어를 위해 수동으로 `try-catch`를 작성하지 않는다. 모든 인프라 레벨의 예외 관리는 프레임워크가 생성한 가드에 위임된다.

---

이 헌법은 Zipbul의 정체성이자 기술적 물리 법칙이다.
모든 에이전트와 개발자는 이 법칙을 **기계적으로 집행**해야 한다.

---

### Terminology Note (Non-Exhaustive)

- **Result:** 성공 또는 실패를 명시적으로 표현하는 값 객체로,
  예외 제어 흐름을 대체한다.
- **Explicit Marker:** 빌드 타임에 해석 가능한 정적 표식이며,
  런타임 추론을 요구하지 않는다.
- **Unified Exception Filter:** 시스템 오류를 단일 구조적 경계에서
  처리하기 위한 아키텍처적 개념이다.
