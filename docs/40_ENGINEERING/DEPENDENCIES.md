# DEPENDENCIES

## 목적

- `package.json`의 `dependencies`/`peerDependencies`/`devDependencies` 판정 기준을 고정한다.
- import와 의존성 선언의 불일치를 금지한다.

## 적용 범위

- `packages/*` 전 패키지 및 `examples/*`를 포함한 레포 전체

## 문서 역할 (SSOT)

- 이 문서는 의존성 선언의 **판정 규칙(Policy)** 과 `@zipbul/*` 내부 관계의 최소 기준만 고정한다.
- 패키지 경계/의존 방향(어떤 패키지가 어떤 패키지를 의존할 수 있는지)의 SSOT는 [ARCHITECTURE.md](../20_ARCHITECTURE/ARCHITECTURE.md)다.
- 이 문서는 “그 관계를 `package.json`에서 `dependencies`/`peerDependencies`/`devDependencies` 중 어디에 선언해야 하는가”의 판정 기준을 제공한다.
- 개별 패키지의 “구체적인 의존성 목록”의 SSOT는 각 패키지의 `package.json`이다.
- 따라서 외부 라이브러리의 추가/교체만으로 이 문서를 매번 업데이트하지 않는다.

## 업데이트 트리거

아래 중 하나라도 발생하면 이 문서를 업데이트해야 한다.

- `@zipbul/*` 신규 패키지가 추가되어 분류/매트릭스가 바뀌는 경우
- 패키지 경계/의존 방향이 바뀌는 경우(SSOT: [ARCHITECTURE.md](../20_ARCHITECTURE/ARCHITECTURE.md))
- `dependencies`/`peerDependencies`/`devDependencies` 판정 규칙 자체가 바뀌는 경우
- 특정 패키지의 `peerDependencies` 정책(필수/권장 범위)이 바뀌는 경우

아래는 이 문서의 업데이트 트리거가 아니다.

- 외부 라이브러리(서드파티) 추가/제거/버전 변경
- 구현 변경으로 인한 내부 의존성의 단순 증감(패키지 경계/정책 변화 없음)

## 공통 원칙

- 런타임(emit된 JS)에서 다른 패키지의 코드/값을 import 한다면, 그 의존은 `dependencies` 또는 `peerDependencies`로 선언되어야 한다.
- `devDependencies`는 개발/테스트/타입체크에만 필요한 도구에 한정한다.
- 워크스페이스 루트에 우연히 호이스팅된 의존성에 기대는 선언 누락은 금지한다.

- `peerDependencies`는 “호스트가 제공해야 하는 의존”이다.
  - 일부 패키지 매니저/설치 전략에서는 transitive dependency가 peer를 만족시키지 않는다.
  - 따라서 peer로 선언된 항목은 소비자 애플리케이션(또는 workspace 루트)이 **직접 설치**한다고 가정해야 한다.

- `optionalDependencies`는 기본값으로 사용하지 않는다.
  - optional 통합이 필요하다면 원칙적으로 별도 패키지(플러그인)로 분리하거나, 항상 설치되는 의존으로 `dependencies`에 선언하고 기능 플래그/명시적 계약으로 동작을 제어한다.

- import와 의존성 선언의 불일치는 금지한다.
  - 런타임 import는 `dependencies`/`peerDependencies`로 선언한다.
  - `import type` 같은 타입 전용 import는 기본적으로 런타임 의존이 아니다.
  - 단, 패키지의 public contract(문서/Facade/export된 타입)에서 해당 의존의 타입을 노출한다면, 소비자 타입체크를 위해 `dependencies` 또는 `peerDependencies`로 선언되어야 한다.

## 판정 기준

- `dependencies`
  - 해당 패키지가 실행될 때 함께 설치되어야 하는 의존
- `peerDependencies`
  - 호스트(프로젝트)가 제공해야 하며, 버전 정합성이 중요한 의존
- `devDependencies`
  - 패키지 개발/테스트/타입체크에만 필요한 도구
  - 배포된 패키지의 런타임 실행에 절대 필요하지 않은 항목만 허용한다.
- `optionalDependencies`
  - 기본값으로 사용하지 않는다

## 결정 가이드 (dependencies vs peerDependencies)

- 호스트가 제공해야 하고 “같은 인스턴스 공유”가 중요한 런타임 의존이면 `peerDependencies`를 사용한다.
- 패키지 자체 구현에 항상 필요한 의존이면 `dependencies`를 사용한다.
- 개발/테스트/타입체크/코드 생성 등 개발 시점에만 필요한 도구면 `devDependencies`를 사용한다.

## `@zipbul/logger` 의존성 정책 (명확화)

- `@zipbul/logger`는 레포의 “모든 패키지”가 반드시 필요로 하는 전제 패키지가 아니다.
- 어떤 패키지가 런타임에서 `@zipbul/logger`를 import 한다면, 그 패키지는 반드시 `dependencies` 또는 `peerDependencies`로 `@zipbul/logger`를 선언해야 한다.
- `@zipbul/*` 내부 기본값
  - 런타임 코어(`@zipbul/core`): `dependencies`로 선언한다.
  - 런타임 어댑터/플러그인: 기본값은 `peerDependencies`로 선언한다(호스트가 버전 정합성을 통제).
  - CLI(`@zipbul/cli`): 런타임 패키지에 의존해서는 안 된다(SSOT: `ARCHITECTURE.md`).

## 패키지 분류별 판정

- 아래 분류 및 패키지 간 의존 방향/금지 관계는 [ARCHITECTURE.md](../20_ARCHITECTURE/ARCHITECTURE.md)의 재진술이며, 충돌 시 [ARCHITECTURE.md](../20_ARCHITECTURE/ARCHITECTURE.md)가 우선한다.

- 런타임 코어(`@zipbul/core`)
  - `dependencies`: 코어 런타임에 직접 필요한 패키지(예: `@zipbul/common`, `@zipbul/logger`)
  - `peerDependencies`: 기본값으로 사용하지 않는다

- 런타임 어댑터(예: `@zipbul/http-adapter`)
  - `peerDependencies`: 필수: `@zipbul/core`, (사용 시) `@zipbul/common`, `@zipbul/logger`
  - `dependencies`: 어댑터 자체 구현에 필요한 외부 라이브러리

- 런타임 플러그인(예: `@zipbul/scalar`)
  - `peerDependencies`: 필수: `@zipbul/common`, (사용 시) `@zipbul/logger`
  - `dependencies`: 플러그인 자체 구현에 필요한 외부 라이브러리

- 공용 기반(`@zipbul/common`, `@zipbul/logger`)
  - `dependencies`: 자체 런타임 구현에 필요한 외부 라이브러리만 선언한다
  - `peerDependencies`: 기본값으로 비운다

- CLI 툴링(`@zipbul/cli`)
  - `dependencies`: CLI 실행/분석/생성에 필요로 하는 라이브러리 및 패키지
    - 단, 프레임워크 런타임 구현 패키지(`@zipbul/core`, `@zipbul/http-adapter`, `@zipbul/scalar`, `@zipbul/logger`)에 의존해서는 안 된다.
    - CLI가 프레임워크 계약(Contract)을 공유해야 한다면, `@zipbul/common`에만 의존할 수 있다.
  - `peerDependencies`: 기본값으로 비운다

## 패키지별 의존성 타입 매트릭스 (패키지 단위)

- 이 매트릭스는 현행 패키지에 대한 적용 예시이며, 분류 규칙이 SSOT다.

- `@zipbul/common`
  - `dependencies`: 외부 라이브러리만
  - `peerDependencies`: 비움

- `@zipbul/logger`
  - `dependencies`: 외부 라이브러리만
  - `peerDependencies`: 비움

- `@zipbul/core`
  - `dependencies`: `@zipbul/common`, `@zipbul/logger` 및 코어 런타임에 직접 필요한 외부 라이브러리
  - `peerDependencies`: 비움

- `@zipbul/http-adapter`
  - `dependencies`: 어댑터 자체 구현에 필요한 외부 라이브러리
  - `peerDependencies`: 필수: `@zipbul/core`, `@zipbul/common`, `@zipbul/logger`

- `@zipbul/scalar`
  - `dependencies`: 플러그인 자체 구현에 필요한 외부 라이브러리
  - `peerDependencies`: 필수: `@zipbul/common`, (사용 시) `@zipbul/logger`

- `@zipbul/cli`
  - `dependencies`: CLI 실행에 필요한 라이브러리(파서/파일 I/O/템플릿 등)
  - `peerDependencies`: 비움
