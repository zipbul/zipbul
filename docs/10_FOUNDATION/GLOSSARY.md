# Glossary (용어 사전)

Zipbul 프로젝트에서 사용되는 주요 기술 용어와 도메인 개념의 SSOT 정의이다.

---

## 1. 아키텍처 개념 (Architecture Concepts)

- **Foundation**: 시스템이 동작하기 위한 최소한의 불변의 논리 및 기반 기술.
- **Contract**: 모듈 간 상호작용을 정의하는 인터페이스 및 제약 사항.
- **Public Facade**: 외부 모듈에 노출되는 유일한 진입점 (`index.ts`).

- **App-External Code**: Application(App) 인스턴스 외부에서 실행되는 코드. (예: bootstrap 단계의 사용자 코드)

- **Entry Module**: Application(App)을 구성하기 위한 시작점으로 지정되는 단일 모듈 참조이다.

- **app.attachAdapter**: App-External Code에서 특정 AdapterId에 대한 런타임 옵션을 바인딩하고, 해당 어댑터를 실행 준비 상태로 전이시키는 App 조작이다.

- **Runtime Report**: 런타임에서 관측되는 실행 사실(어댑터 활성화/리스닝/바인딩/옵션 값 등)을 기록한 산출물이다.
  - Runtime Report는 **관측(observation)** 만을 포함하며, 런타임에서의 판단/추론을 포함해서는 안 된다.
  - Runtime Report의 생산자는 DevTools 등 관측 도구이며, 런타임 실행 경로를 변경해서는 안 된다.
  - Runtime Report는 런타임 메모리 내 산출물로 취급하며, 앱 종료 또는 보고 완료 시점까지의 수명을 가진다.
  - Runtime Report 생성/수집 과정에서 런타임 reflection 기반 탐색(`reflect-metadata` 등)은 금지된다.

- **MCP Server**: 개발자(사용자)가 프레임워크와 상호작용하며 분석/생성/변경/검증을 수행하도록 돕는 서버.

- **createApplication**: App 인스턴스를 생성하는 부트스트랩 진입점이다.
- **app.start**: App을 실행 상태로 전이시키는 실행 진입점이다.
- **app.stop**: App을 종료 상태로 전이시키는 종료 진입점이다.
- **app.get**: App-External Code에서 singleton/all Provider 인스턴스에 접근하기 위한 진입점이다.

- **defineConfig**: Config Section을 등록하기 위한 App-External Code의 등록 호출 식별자이다.

- **isAttached**: DevTools runtime report에서 특정 어댑터의 옵션 바인딩(attach)이 완료되었음을 나타내는 상태 값이다.
- **isRunning**: DevTools runtime report에서 특정 어댑터가 실행 상태에 진입했음을 나타내는 상태 값이다.

- **onModuleInit**: `@Injectable()` Provider 초기화 시점에 호출되는 애플리케이션 생명주기 훅 메서드명이다.
- **onModuleDestroy**: `@Injectable()` Provider 종료(dispose) 시점에 호출되는 애플리케이션 생명주기 훅 메서드명이다.
- **onApplicationBootstrap**: 애플리케이션 부트스트랩 완료 시점에 호출되는 애플리케이션 생명주기 훅 메서드명이다.
- **beforeApplicationShutdown**: 애플리케이션 종료 직전에 호출되는 애플리케이션 생명주기 훅 메서드명이다.
- **onApplicationShutdown**: 애플리케이션 종료 완료 시점에 호출되는 애플리케이션 생명주기 훅 메서드명이다.

- **Adapter**: 특정 프로토콜(HTTP/WS 등)의 입력을 표준 실행 모델로 연결하고, 결과를 프로토콜 표현으로 렌더링하는 계층이다.

- **Provider**: DI 그래프에 의해 생성/주입되는 대상이며, 명시된 생명주기를 가진다.
- **Scope**: Provider의 인스턴스 공유 범위(예: 전역/요청/모듈 등). `singleton | request | transient`를 기본 집합으로 고정한다.

- **Core**: 프로토콜을 인지하지 않는 비즈니스 로직 계층이다. Core는 프로토콜 종속 입력/출력 표현을 전제로 하지 않으며, 어댑터 경계를 통해서만 프로토콜과 결합된다.
- **Engine**: 프레임워크의 핵심 실행 엔진이다. Engine은 빌드 타임에 확정된 정적 연결(wiring)에 의해 실행 경로가 고정되며, 런타임에 사용자에 의해 교체·후킹·변형될 수 없다.

- **ContextId**: 요청 컨텍스트를 식별하기 위한 정적 동일성 값이다.
- **AdapterName**: 어댑터 패키지(프로토콜 구현)를 식별하기 위한 이름이다.
- **AdapterId**: App에 attach되는 어댑터 인스턴스를 식별하기 위한 정적 동일성 값이다.
- **HandlerId**: 핸들러를 결정적으로 식별하기 위한 문자열이다. (형식/규칙은 diagnostics.spec.md의 HandlerId 계약을 따른다)
- **ModuleId**: 모듈을 식별하기 위한 정적 동일성 값이다.
- **Context**: 실행 시점의 컨텍스트 오브젝트이며, 최소 `contextId`와 `adapterId`를 포함한다.

- **ZipbulAdapter**: 런타임 어댑터 실행체의 기반 추상 클래스이다. 각 프로토콜 어댑터의 실행체는 `ZipbulAdapter`를 상속하는 concrete class로 구현되어야 한다.

- **Pipeline**: 어댑터가 정적으로 선언하는 실행 단계열(순서 포함)이다. 프레임워크/컴파일러는 Pipeline 선언을 인지하여 정적 wiring을 생성한다.
- **PipelineStep**: Pipeline을 구성하는 단일 실행 단위이다.
- **ReservedPipeline**: Pipeline 내 예약된 실행 단계를 나타내는 enum이다. 값은 `Guards`, `Pipes`, `Handler`이며 사용자가 재정의할 수 없다.
- **AdapterPipelines**: 어댑터가 `defineAdapter`에 선언하는 pipeline 배열의 타입이다. `(MiddlewarePhase | ReservedPipeline)[]` 형태이다.
- **MiddlewarePhase**: 어댑터가 정의하는 미들웨어 실행 단계 식별자. 문자열 타입(`string`)이며 `:` 문자를 포함하지 않아야 한다.
- **Exception Filter**: throw로 발생한 예외를 입력으로 받아, 표준 Result로 변환하거나(처리) 다음 단계로 전달(통과)하는 실행 단계이다.
- **Exception Filter Chain**: 순서가 있는 Exception Filter의 리스트이다. 예외는 체인의 앞에서 뒤로 전달되며, 처리되지 않은 예외는 체인의 후단으로 전달된다.
- **Error**: 도메인 실패로서 Result 경로(값 흐름)로 처리되는 에러.
- **Panic**: throw로 표현되는 시스템 오류.
- **Middleware**: 입력/컨텍스트를 전처리하거나 공통 cross-cut을 적용하는 실행 단계이다.
- **Middleware Phase**: 어댑터가 정의하는 미들웨어 실행 단계 식별자. GLOSSARY 항목: `MiddlewarePhase`를 참조.
- **DecoratorRef**: 엔트리 판정(decorator) 입력으로 사용되는 정적 함수 참조이다.
- **Adapter Owner Decorator**: 특정 어댑터의 엔트리 선언을 소유하는 class-level 데코레이터.
- **Adapter Member Decorator**: 특정 어댑터에 종속되는 member/parameter 데코레이터.
- **Guard**: 핸들러 접근을 제어하는 실행 단계이다. 목적은 보안/권한/접근 제어이며, 데이터 변환/검증과 무관하다.
- **Pipe**: 데이터 가공을 수행하는 실행 단계(또는 그 컨테이너)이다. Pipe는 변환(transform) 및 검증(validate)을 포함할 수 있으나, 접근 제어(Guard)를 포함하지 않는다.
- **Transform**: 입력 representation을 다른 representation으로 변환하는 데이터 가공 동작이다.
- **Validate**: 입력을 검사하여 통과 또는 거부를 결정하는 데이터 가공 동작이다.
- **Handler**: 어댑터가 최종적으로 호출하는 사용자 함수(요청 처리 엔트리)이다.

- **DTO**: 데이터 전송 객체. 비즈니스 로직을 포함하지 않는 구조적 데이터이다.

- **DTO Transformer**: 입력을 DTO 값으로 변환하는 transform 동작.
- **DTO Validator**: DTO 값을 검사하는 validate 동작.

- **Raw Input**: 프레임워크가 변환/검증 완료를 가정하지 않는 입력 모드이다. Raw Input은 핸들러로 그대로 전달될 수 있다.
- **Consistency**: 실행 표면과 명세 산출물이 불일치하지 않는 성질.

- **Non-intrusive**: DevTools가 활성화되어도 실행 결과/경로/판정이 바뀌지 않는 성질.

- **Normal Path**: 예외(throw)가 발생하지 않는 실행 경로.

---

## 2. 모듈 및 의존성 (Modules & Dependencies)

- **AOT**: 런타임 이전(빌드 또는 정적 분석 단계)에 수행되는 처리.

- **Wiring**: 빌드 타임에 확정된 정적 연결 코드(또는 계획).

- **ORM Integration**: 데이터 계층을 프레임워크 구조/DI/Provider 모델에 연결하는 기능.

---

## 3. 엔지니어링 및 테스트 (Engineering & Testing)

- **Reflections**: 런타임에 객체의 메타데이터를 조회하거나 수정하는 행위. Zipbul에서는 금지됨.

- **Mechanically Checkable**: 해석 없이 정해진 입력/산출물에 대해 결정 절차로 참/거짓 판정이 가능한 성질.

- **Safety**: 메모리/리소스/오류 전파가 정의된 계약을 따르는 성질.
- **Correlation**: 하나의 요청/작업/실행 흐름을 연결하는 식별자/컨텍스트.

---

## 4. 거버넌스 (Governance)

- **Persona**: 에이전트가 수행하는 특정 역할(Architect, Implementer, Reviewer).
