# SSOT Hierarchy (문서 권위 위계)

본 문서는 Zipbul 프로젝트의 모든 **문서 간 권위 위계**와 **충돌 해결 원칙**을 정의하는
유일한 정본(SSOT)이다.

---

## 1. 개요 (Overview)

모든 기술 문서는 번호로 식별되는 위계를 가지며,
**낮은 번호의 디렉토리에 위치한 문서가 높은 번호의 디렉토리에 위치한 문서보다 상위 권위**를 가진다.

- **위계 = 권위의 높이 = 읽는 순서**

본 위계는 문서 판정과 충돌 해결에만 사용되며,
행동 집행은 별도의 Enforcement Layer(E0)에 의해 수행된다.

### Canonical References

- 문서 권위 위계의 정본(SSOT)은 본 문서 하나로 고정한다.
- 구조/경계(패키지 경계, 단방향 의존 등) 규칙의 정본(SSOT)은 [ARCHITECTURE.md](../20_ARCHITECTURE/ARCHITECTURE.md)다.
- 다른 문서는 위 두 정본을 링크로 참조하며, 동일한 “정본/우선순위” 보일러플레이트를 반복 기재하지 않는다.

---

## E0. Enforcement Layer (집행 레이어)

**AGENTS.md**는 문서 위계에 포함되지 않는 **Out-of-Band 집행 레이어(E0)**이다.

- E0는 **문서가 아니다**
- E0는 **권위 비교의 피연산자가 아니다**
- E0는 **문서 내용을 해석하지 않는다**

E0의 유일한 역할은:

- L1~L5 문서를 기준으로 **행동을 허용하거나 차단**하는 것뿐이다.

> E0는 집행자(enforcer)이며,  
> 문서 위계의 일부가 아니라 **위계를 적용하는 관문(gatekeeper)**이다.

---

## 2. 계층별 정의 (Hierarchy Levels)

아래는 **문서 위계에 포함되는 기술 문서들만**을 정의한다.

|  등급   | 위치                    | 성격                                        | 대표 문서                                                             |
| :-----: | :---------------------- | :------------------------------------------ | :-------------------------------------------------------------------- |
| **L1**  | `docs/10_FOUNDATION/`   | **헌법 (Invariants)**                       | INVARIANTS                                                            |
| **L2**  | `docs/20_ARCHITECTURE/` | **구조 (Boundary)**                         | ARCHITECTURE, STRUCTURE                                               |
| **L3**  | `docs/30_SPEC/`         | **계약 (Contract)**                         | SPEC, `*.spec.md`                                                     |
| **L4**  | `docs/40_ENGINEERING/`  | **규율 (Discipline)**                       | STYLEGUIDE, TESTING, VERIFY                                           |
| **L5**  | `docs/50_GOVERNANCE/`   | **위생 (AI Judgment & Repository Hygiene)** | OVERVIEW, POLICY, DOCS_WRITING, SAFEGUARDS, COMMITS, DEAD_CODE_POLICY |
| **Ref** | `docs/90_REFERENCE/`    | **참고 (Non-SSOT)**                         | VISION, ROADMAP                                                       |

---

## 3. 충돌 해결 원칙 (Conflict Resolution)

문서 간 내용이 상충할 경우, 에이전트는 아래 규칙을 **기계적으로** 적용한다.

1. **상위 권위 우선**  
   낮은 번호(L1이 가장 높음)의 문서가 항상 우선한다.  
   (예: ARCHITECTURE는 SPEC보다 우선)

2. **명시적 금지 우선**  
   상위 문서에서 금지한 사항은 하위 문서에서 허용하더라도 무효다.

3. **즉시 중단 범위 (Immediate Stop Scope)**  
   사용자의 지시 또는 작업이 **L1~L5 문서**를 위반할 경우:
   - **Implementer / Architect**: 즉시 경고 후 작업을 중단(MUST STOP)
   - **Reviewer**: 해당 산출물을 Reject 판정

4. **Reference 문서의 비판정성**  
   `docs/90_REFERENCE/` 문서는:
   - 판정 근거가 아니다
   - 즉시 중단의 근거가 아니다
   - 충돌 해결에 사용되지 않는다

5. **해석 금지**  
   문서 간 차이를 에이전트가 임의로 해석하거나 타협안을 만들지 않는다.  
   불확실한 경우 즉시 중단한다.

### Enforcement Output Rules

- **Conflict Output Rule:** 문서 충돌 또는 위반 감지 시,
  에이전트는 반드시 다음을 명시적으로 출력한 후 작업을 중단한다.
  (1) 위반 문서,
  (2) 위반 조항,
  (3) 중단 사유.

- **Undefined Case Handling:** 상위 문서에 명시되지 않은 사항이
  판정에 필수적인 경우, 해석하지 않고 즉시 중단(STOP IF UNCERTAIN)한다.

---

## 4. 번호 체계의 의미 (Numbering Semantics)

- **10_FOUNDATION**  
  변하지 않는 논리적 불변식과 권위 체계의 정본

- **20_ARCHITECTURE**  
  시스템의 구조적 경계와 의존성 방향

- **30_SPEC**  
  구현해야 할 기능의 계약과 제약

- **40_ENGINEERING**  
  코드를 작성·검증·실행하는 규율

- **50_GOVERNANCE**  
  **AI 판단 규칙 및 저장소 위생 정책**
  (사람 조직/운영 프로세스는 포함하지 않는다)

  대표 문서:
  - `OVERVIEW.md`: 승인 아티팩트 및 승인 필요 변경 유형
  - `POLICY.md`: 단일 위반 즉시 차단 정책
  - `DOCS_WRITING.md`: 문서 작성 규율(집행 대상)
  - `SAFEGUARDS.md`: 패턴/반복 기반 중단/롤백
  - `COMMITS.md`: 커밋 규칙 및 메타데이터
  - `DEAD_CODE_POLICY.md`: 데드 코드/파일 관리 정책

---

## 5. Non-Goals

본 문서는 다음을 정의하지 않는다.

- 구현 방법
- 코드 스타일의 세부 규칙
- 운영 조직 정책
- Reference 문서의 해석

이러한 영역은 해당 레벨 문서의 책임이다.
