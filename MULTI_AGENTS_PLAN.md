# Multi-Agent Orchestra — 멀티 에이전트 오케스트레이션 기획서

> **상태:** 기획 (Draft)
> **최종 갱신:** 2026-02-13
> **관련:** PLAN.md (Card-centric MCP Index Design)

---

## 목차

1. [비전과 목적](#1-비전과-목적)
2. [논문 근거](#2-논문-근거)
3. [에이전트 정체성 — R²AP 4축](#3-에이전트-정체성--r²ap-4축)
4. [페르소나 카탈로그](#4-페르소나-카탈로그)
5. [토론 프로토콜](#5-토론-프로토콜)
6. [Phase별 배치](#6-phase별-배치)
7. [Model Orchestra — 모델 다양성 전략](#7-model-orchestra--모델-다양성-전략)
8. [실행 아키텍처](#8-실행-아키텍처)
9. [카드 시스템 연동](#9-카드-시스템-연동)
10. [설정 구조](#10-설정-구조)
11. [미결정 사항](#11-미결정-사항)
12. [결정 로그](#12-결정-로그)

---

## 1. 비전과 목적

### 1.1 왜 만드는가

AGI 시대가 도래하면 사람의 역할은 **에이전트가 최고 효율로 일할 수 있는 환경을 만드는 것**으로 수렴한다.

zipbul 프레임워크는 이미 에이전트 친화적으로 설계되어 있다:

- **Marker-Based Role Identification** → 에이전트가 추측 없이 코드 역할 파악
- **Directory-First Modularity** → 파일 구조만으로 아키텍처 이해
- **Build-Time Intelligence** → 런타임 동작을 사전 추론 가능
- **Automation Without Opacity** → 투명한 자동화
- **Structure Over Rules** → 규칙 나열이 아닌 구조적 강제

멀티 에이전트 오케스트레이션은 이 설계의 **자연스러운 확장**이다.

### 1.2 핵심 전략

**"토론은 싸게, 결론만 비싸게"**

저가 모델(Free tier)을 다수 활용하여 관점 다양성을 확보하고, 고가 모델(Standard/Premium)은 종합 판단에만 집중한다.

### 1.3 차별화

| 기존 멀티 에이전트 | zipbul Agent Orchestra |
|--------------------|----------------------|
| API key 필수 | MCP Sampling — 사용자 키 불필요 |
| Docker / 별도 프로세스 | Bun Worker — 단일 프로세스 내 병렬 |
| 같은 모델 + persona 차이 | 다른 모델 = 자연적 관점 분화 |
| 역할만 부여 | R²AP 4축 (역할+책임+권한+페르소나) + 논문 기반 행동 지침 |
| 독립 도구 | 카드 시스템과 통합 (토론 → 카드 → 구현 → 검증) |

---

## 2. 논문 근거

### 2.1 멀티 에이전트 토론

| 논문 | 핵심 발견 | 우리 설계에 적용 |
|------|----------|----------------|
| **Du et al. (2023)** — "Improving Factuality and Reasoning through Multiagent Debate" | 여러 LLM 인스턴스가 라운드 기반 토론으로 공통 답변에 수렴. 수학/전략 추론에서 유의미한 향상. 환각 감소. | 라운드 기반 토론 구조. 동일 프레임워크로 모든 phase 적용. |
| **Liang et al. (2023, EMNLP 2024)** — "Encouraging Divergent Thinking through Multi-Agent Debate" | Self-reflection은 **Degeneration-of-Thought (DoT)** 문제 — 한번 확신하면 새 생각 못 함. MAD 프레임워크로 해결. | **(1)** 적응적 종료(adaptive break) 도입. **(2)** "modest tit for tat" — 적절한 반박 수준 설정. **(3)** 다른 모델 간 Judge 편향 주의 → 익명화. |
| **Chan et al. (2023)** — "ChatEval: Better LLM-based Evaluators through Multi-Agent Debate" | 다중 에이전트 심판 팀이 자율 토론으로 평가. 인간 모방 평가 프로세스. | Review phase의 Panel + Judge 패턴. |

### 2.2 멀티 에이전트 협업 구조

| 논문 | 핵심 발견 | 우리 설계에 적용 |
|------|----------|----------------|
| **Hong et al. (2023)** — "MetaGPT: Meta Programming for Multi-Agent Collaborative Framework" | SOPs(표준 운영 절차)를 프롬프트 시퀀스로 인코딩. Assembly line 패러다임. 중간 결과 검증으로 환각 감소. | R²AP의 "책임"에 SOP 형태의 사고 절차를 포함. |
| **Zhang et al. (2023, ACL 2024)** — "Exploring Collaboration Mechanisms: A Social Psychology View" | 에이전트에 **trait(특성) + thinking pattern(사고 패턴)** 부여. 특정 협업 전략이 최고 성과 달성 + API 토큰 절약. LLM이 인간과 유사한 사회적 행동(동조, 합의) 보임. | **R²AP의 Persona 축** — trait + thinking pattern 조합. |
| **Guo et al. (2024)** — "LLM-based Multi-Agents: A Survey of Progress and Challenges" | 멀티 에이전트 프로파일링, 통신 방식, 역량 성장 메커니즘의 체계적 분류. | 전체 아키텍처 설계의 분류 체계 참고. |

### 2.3 집단 지성과 페르소나

| 연구 | 핵심 발견 | 우리 설계에 적용 |
|------|----------|----------------|
| **Chuang et al. (2023)** — "Wisdom of Partisan Crowds" | 편향적 페르소나를 부여한 LLM 에이전트 그룹이 토론을 통해 **더 정확한 결론으로 수렴**. 의도적 편향이 집단 지성을 강화. | 에이전트에 의도적 편향(Persona)을 부여하는 것이 정당화됨. |
| **Belbin (1981)** — "Management Teams: Why They Succeed or Fail" | 9가지 팀 역할. **"지능이 아니라 균형(balance)이 팀을 성공시킨다."** 최적 팀 크기 4명. | 3-4 Panel + 1 Judge = 4-5 에이전트 구성. 페르소나 균형 배치. |

### 2.4 설계 원칙 추출 (논문 종합)

논문들에서 추출한 9가지 설계 원칙:

| # | 원칙 | 출처 |
|---|------|------|
| P1 | 라운드 기반 토론이 자기 반성(self-reflection)보다 우월하다 | Liang et al. |
| P2 | 적응적 종료(adaptive break)가 필요하다 — 고정 라운드 수 불가 | Liang et al. |
| P3 | "modest tit for tat" — 적절한 반박 수준이 핵심. 과격→발산, 순종→groupthink | Liang et al. |
| P4 | 다른 모델 간 Judge가 편향될 수 있다 → 익명화 필요 | Liang et al. |
| P5 | SOP를 프롬프트 시퀀스로 인코딩하면 환각 감소 | MetaGPT |
| P6 | trait + thinking pattern 조합이 역할만 부여하는 것보다 효과적 | Zhang et al. |
| P7 | 의도적 편향이 집단 지성을 강화한다 | Chuang et al. |
| P8 | 지능이 아니라 역할 균형이 팀을 성공시킨다 | Belbin |
| P9 | 최적 팀 크기는 4명이다 | Belbin |

---

## 3. 에이전트 정체성 — R²AP 4축

에이전트의 정체성은 **4개 축**으로 정의된다:

### 3.1 축 정의

| 축 | 의미 | 내용 |
|----|------|------|
| **Role (역할)** | 구조적 위치 | Panel 참가자 / Judge / Drafter / Critic / Reviewer |
| **Responsibility (책임)** | 뭘 해야 하는가 | 관점 범위(scope) + 산출물(output format) + 배제 범위(exclusion) |
| **Authority (권한)** | 뭘 할 수 있는가 | 결정권 + 접근권 + 추가 행동(추가 라운드 요청 등) |
| **Persona (페르소나)** | 어떻게 사고하는가 | trait(특성) + thinking pattern(사고 절차) — §4 카탈로그 참조 |

### 3.2 R²AP 위의 메타 레벨

R²AP는 개별 에이전트의 정체성이다. 그 위에 **세션 설정**이 있다:

```
세션 설정 (Session Config)
  ├── Phase Topology: Panel+Judge / Chain / Lead+Reviewer
  ├── Model Placement: 어떤 에이전트에 어떤 모델
  ├── Round Settings: 최대 라운드, 수렴 조건
  └── Strategy Preset: free-only / balanced / quality / max
```

### 3.3 예시: Ideation Phase의 에이전트 정의

**Panel Agent A — Innovator:**
```yaml
role: panel
responsibility:
  scope: "기존 전제를 의심하고 비정형적 해법을 탐색"
  output: "전제 목록 → 전제 제거 해법 → 비정형 접근 2개 이상"
  exclusion: "구현 세부사항, 비용 분석"
authority:
  decision: "의견 제출만. 최종 결정 불가."
  access: "문제 정의 + 카드 컨텍스트. 다른 패널 의견 접근 불가(Round 0)."
  actions: "없음"
persona: innovator  # §4.1 참조
model_hint: "gpt-4o"  # Free tier
```

**Judge Agent — Synthesizer:**
```yaml
role: judge
responsibility:
  scope: "모든 패널 의견을 종합하여 실현 가능성/영향도/독창성 기준으로 평가"
  output: "채택 제안 top 3 + 각 선정 근거 + 기각 사유"
  exclusion: "없음 — 전체 범위"
authority:
  decision: "최종 결론 결정권. 패널 의견 기각 가능."
  access: "전체 대화 로그 (익명화 상태)"
  actions: "추가 라운드 요청 가능. 특정 에이전트에 보충 질문 가능."
persona: analyst  # §4.2 — Judge는 분석적 사고가 기본
model_hint: "claude-sonnet-4"  # Standard tier
```

---

## 4. 페르소나 카탈로그

**페르소나는 "추상적 성격"이 아니라 "구체적 행동 지침(behavioral directives)"이다.**

zipbul의 "Structure Over Rules" 원칙을 에이전트에 적용:
```
❌ "너는 분석적이고 신중한 성격이야"
✅ 구체적 사고 절차 + 출력 형식 + 판단 기준을 강제
```

### 기반 이론

- **Belbin Team Roles (1981)** — 9개 팀 역할 중 소프트웨어 개발에 적용 가능한 6개 추출
- **De Bono Six Thinking Hats (1985)** — Black Hat(위험 탐지)를 보완 역할로 추가
- **Inversion Thinking (Munger)** — 역산 사고를 Sentinel 페르소나에 통합

### 4.1 Innovator (혁신가)

**기반:** Belbin Plant — 창의적, 비정형적, 아이디어 생성자

**Trait:** 기존 전제를 의심한다. 정답이 아닌 가능성을 탐색한다.

**Thinking Pattern (사고 절차):**
1. 문제에 깔린 숨은 전제(hidden assumptions)를 식별하라
2. 각 전제를 제거했을 때의 해법 공간을 탐색하라
3. 기존 접근과 완전히 다른 대안을 최소 2개 이상 제시하라
4. 각 대안의 "만약 이게 된다면?" 시나리오를 간략히 그려라

**출력 형식:**
```
[전제] 현재 깔려 있는 전제 N개
[전제 제거] 전제 X를 제거하면 → 가능해지는 접근
[대안 1] ...
[대안 2] ...
[가능성] 각 대안이 성공했을 때의 임팩트
```

**배치 우선순위:** Ideation, Review

---

### 4.2 Analyst (분석가)

**기반:** Belbin Monitor Evaluator — 냉정, 논리적, 공정한 평가자

**Trait:** 감정을 배제하고 데이터와 논리로만 판단한다. 모든 선택지를 동등하게 검토한다.

**Thinking Pattern (사고 절차):**
1. 모든 선택지를 MECE(Mutually Exclusive, Collectively Exhaustive)로 나열하라
2. 각 선택지를 최소 3개 기준으로 평가하라 (복잡도, 유지보수성, 성능 등)
3. 정량화 가능한 것은 반드시 숫자로 표현하라
4. "좋다/나쁘다" 같은 정성적 판단은 금지. 트레이드오프로 표현하라

**출력 형식:**
```
[선택지] A / B / C / ...
[평가 기준] 기준1, 기준2, 기준3
[매트릭스] 선택지 × 기준 평가표
[최적 선택] ... (근거: ...)
[트레이드오프] 최적 선택의 대가
```

**배치 우선순위:** 모든 Phase (Judge 기본 페르소나)

---

### 4.3 Driver (추진자)

**기반:** Belbin Shaper — 추진력, 도전적, 목표 지향

**Trait:** 실행 속도를 최우선한다. 장애물을 식별하고 돌파 방안을 제시한다.

**Thinking Pattern (사고 절차):**
1. 목표를 한 문장으로 재진술하라
2. 목표 달성을 가로막는 장애물을 전부 나열하라
3. 각 장애물의 돌파 방안을 제시하라 (우회 아닌 정면 돌파 우선)
4. 가장 빠른 실행 경로를 제시하라

**출력 형식:**
```
[목표] 한 문장
[장애물] 1. ... 2. ... 3. ...
[돌파] 각 장애물별 해결 방안
[실행 경로] step 1 → step 2 → ... (예상 소요 리소스)
```

**배치 우선순위:** Ideation, Implementation

---

### 4.4 Pragmatist (실용주의자)

**기반:** Belbin Implementer — 실용적, 체계적, 실행 중심

**Trait:** 현재 코드베이스와의 일관성을 최우선한다. 가장 작은 변경으로 목표를 달성한다.

**Thinking Pattern (사고 절차):**
1. 현재 상태(as-is)를 정확히 파악하라
2. 목표 상태(to-be)와의 최소 차이(diff)를 식별하라
3. 기존 패턴과의 일관성을 확인하라 — 새 패턴 도입 최소화
4. 부작용(side effects)을 나열하고 최소화 경로를 제시하라

**출력 형식:**
```
[현재 상태] ...
[목표 상태] ...
[최소 변경] 변경 지점 N개
[일관성] 기존 패턴과의 정합 여부
[부작용] ... → 완화 방안
```

**배치 우선순위:** Spec, Implementation, Debug

---

### 4.5 Perfectionist (완벽주의자)

**기반:** Belbin Completer Finisher — 꼼꼼, 완벽주의, 디테일 집착

**Trait:** 정상 경로(happy path) 외의 모든 경로를 탐색한다. 누락을 용납하지 않는다.

**Thinking Pattern (사고 절차):**
1. 정상 경로를 식별하라
2. 정상 경로 외의 모든 비정상 경로(edge case, error path, boundary condition)를 나열하라
3. 각 비정상 경로의 현재 처리 방안을 확인하라 (처리 없음 = 누락)
4. 누락된 검증, 테스트, 에러 핸들링을 전부 지적하라

**출력 형식:**
```
[정상 경로] ...
[비정상 경로]
  1. edge case: ... → 처리: (있음/없음)
  2. error path: ... → 처리: (있음/없음)
  3. boundary: ... → 처리: (있음/없음)
[누락 사항] 총 N개
  - ...
```

**배치 우선순위:** Test, Review, Spec

---

### 4.6 Explorer (탐험가)

**기반:** Belbin Resource Investigator — 탐구적, 외부 지식 활용, 기존 사례 중시

**Trait:** 바퀴를 재발명하지 않는다. 기존 해결책에서 답을 찾는다.

**Thinking Pattern (사고 절차):**
1. 이 문제와 유사한 기존 해결책(라이브러리, 패턴, 사례)을 탐색하라
2. 각 선례의 적용 가능성을 평가하라
3. 그대로 적용 가능한 것과 변형이 필요한 것을 분류하라
4. 변형 시 필요한 수정 사항을 정리하라

**출력 형식:**
```
[선례]
  1. {이름} — {출처} — {핵심 아이디어}
  2. ...
[적용 가능성]
  - 그대로 적용: ...
  - 변형 필요: ... → 변형 내용
[추천] ...
```

**배치 우선순위:** Ideation, Spec

---

### 4.7 Sentinel (파수꾼)

**기반:** De Bono Black Hat + Inversion Thinking (Charlie Munger)

**Trait:** "어떻게 하면 실패하는가?"에서 출발한다. 모든 제안의 최악 시나리오를 구성한다.

**Thinking Pattern (사고 절차):**
1. 제안된 접근이 **실패하는 시나리오**를 최소 3개 구성하라
2. 각 실패의 심각도를 평가하라 (복구 가능/불가능, 영향 범위)
3. 가장 심각한 실패부터 완화(mitigation) 방안을 제시하라
4. 완화 불가능한 실패가 있으면 명시적으로 경고하라

**출력 형식:**
```
[실패 시나리오]
  1. {상황} → 심각도: {high/medium/low} → 복구: {가능/불가능}
  2. ...
  3. ...
[완화 방안]
  - 시나리오 1: ...
  - 시나리오 2: ...
[경고] 완화 불가능: {있음/없음} — {내용}
```

**배치 우선순위:** Test, Review, Debug

---

### 4.8 페르소나 배치 매트릭스

| Phase | Panel 페르소나 (Free) | Judge 페르소나 (Standard+) |
|-------|----------------------|--------------------------|
| **Ideation** | Innovator, Analyst, Explorer, Driver | Analyst |
| **Spec** | Analyst, Pragmatist, Perfectionist | Analyst |
| **Test** | Perfectionist, Sentinel, Pragmatist | Analyst |
| **Implementation** | Pragmatist (Lead), Perfectionist (Reviewer) | — (Chain 구조) |
| **Debug** | Analyst, Sentinel | Analyst |
| **Review** | Analyst, Perfectionist, Sentinel, Explorer | Analyst |

**원칙 (P8, P9 적용):** 각 Phase에 3-4명 Panel + 1 Judge = 4-5 에이전트. 역할 균형 우선.

---

## 5. 토론 프로토콜

### 5.1 메시지 구조

```typescript
interface AgentMessage {
  agentId: string;          // 발신 에이전트 (Judge에게는 익명화)
  round: number;            // 라운드 번호
  type: 'proposal' | 'critique' | 'synthesis' | 'verdict';
  content: string;          // 페르소나의 출력 형식에 따른 구조화 텍스트
  confidence: number;       // 0.0–1.0 확신도
  agreements: string[];     // 동의하는 이전 포인트 (요약)
  disagreements: string[];  // 반대하는 이전 포인트 (요약 + 대안)
  newPoints: string[];      // 이번 라운드에서 새로 제시하는 포인트
}
```

### 5.2 라운드 흐름 — Panel + Judge (Ideation, Review)

```
┌─────────────────────────────────────────────────┐
│ Round 0 — Independent Proposals                 │
│                                                 │
│  Worker A (Innovator) ──┐                       │
│  Worker B (Analyst)   ──┼── 병렬 실행 (서로 못 봄) │
│  Worker C (Explorer)  ──┤                       │
│  Worker D (Driver)    ──┘                       │
│                                                 │
│  각 에이전트: type='proposal', 독립 의견 제출      │
├─────────────────────────────────────────────────┤
│ Round 1..N — Debate                             │
│                                                 │
│  모든 이전 메시지를 각 에이전트에 broadcast         │
│  각 에이전트: type='critique'                    │
│  agreements / disagreements / newPoints 필수      │
│  병렬 실행                                       │
│                                                 │
│  → 수렴 감지 (§5.4) → converged? → Round N+1    │
│  → 미수렴 + max_rounds 미도달 → Round N+1 반복   │
├─────────────────────────────────────────────────┤
│ Final Round — Verdict                           │
│                                                 │
│  Judge 에이전트에게 전체 대화 로그 전달 (익명화)    │
│  Judge: type='verdict', 최종 결론 + 근거          │
└─────────────────────────────────────────────────┘
```

### 5.3 라운드 흐름 — Chain (Spec, Test, Debug)

```
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│ Step 1: Draft │ ──→ │ Step 2: Critique│ ──→ │ Step 3: Verdict│
│ Drafter       │     │ Critic         │     │ Judge          │
│ type=proposal │     │ type=critique  │     │ type=verdict   │
└───────────────┘     └───────────────┘     └───────────────┘
                                                    │
                                             필요 시 Drafter에
                                             수정 요청 (추가 라운드)
```

### 5.4 수렴 감지 (Adaptive Break)

**설계 원칙 P2 적용:** 고정 라운드 수가 아니라 수렴 조건 기반으로 종료.

```typescript
interface ConvergenceDetector {
  check(messages: AgentMessage[]): ConvergenceResult;
}

interface ConvergenceResult {
  converged: boolean;
  reason: 'consensus' | 'confidence' | 'stalemate' | 'diminishing' | 'max_rounds';
  details: string;
}
```

**수렴 조건 (OR — 하나라도 충족 시 종료):**

| 조건 | 판정 기준 | 설계 원칙 |
|------|----------|----------|
| **Consensus** | 마지막 라운드에서 전체 agreements 수 > disagreements 수 × 2 | P3 |
| **Confidence** | 마지막 라운드 평균 confidence > 0.8 | — |
| **Stalemate** | newPoints = 0인 라운드가 2회 연속 | P2 |
| **Diminishing** | 이전 라운드 대비 newPoints 수가 50% 이하로 감소 | P2 |
| **Max Rounds** | 최대 라운드 도달 (Panel: 3, Chain: 2) | — |

### 5.5 반박 수준 제어 (Modest Tit for Tat)

**설계 원칙 P3 적용:** 너무 공격적이면 발산, 너무 순종적이면 groupthink.

모든 토론 참가자의 system prompt에 포함되는 반박 가이드라인:

```
## 토론 가이드라인

- 동의할 때: 간결히 동의 표시. 추가 근거가 있으면 보충.
- 반대할 때: 반드시 대안을 함께 제시. "아니다"만으로는 부족.
- 상대의 가장 강한 논점(steel man)을 먼저 인정한 후 반박.
- 확신도 0.7 이하인 포인트는 "가능성"으로 제시. 단정 금지.
- 이전 라운드에서 이미 반박된 포인트를 반복하지 말 것.
```

### 5.6 Judge 익명화

**설계 원칙 P4 적용:** 다른 모델을 쓸 때 Judge가 특정 모델 출력 스타일에 편향될 수 있다.

```typescript
function anonymizeForJudge(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((msg, i) => ({
    ...msg,
    agentId: `Agent-${String.fromCharCode(65 + i % 26)}`,
    // Agent-A, Agent-B, Agent-C, Agent-D
  }));
}
```

Judge에게 전달 시:
- 모델명 제거
- 에이전트 ID를 순서 기반 익명 라벨로 교체
- 내용(content)만으로 평가하도록 system prompt에 명시

---

## 6. Phase별 배치

### 6.1 Phase-Adaptive Structure

모든 phase에 같은 구조를 강제하지 않는다. Phase의 성격에 따라 최적 구조가 다르다:

| Phase | 구조 | 에이전트 수 | 목적 |
|-------|------|-----------|------|
| **Ideation** | Panel + Judge | 4 + 1 = 5 | 관점 다양성 극대화. 발산적 사고. |
| **Spec** | Chain (Drafter → Critic → Judge) | 3 | 순차 정제. 초안 → 비평 → 확정. |
| **Test** | Chain (Drafter → Critic → Judge) | 3 | 테스트 작성 → 엣지케이스 비평 → 확정. |
| **Implementation** | Lead + Reviewer | 2 | 1인 구현 + 코드 리뷰. |
| **Debug** | Chain (Analyst → Hypothesizer → Verifier) | 3 | 분석 → 가설 → 검증. |
| **Review** | Panel + Judge | 4 + 1 = 5 | 다중 관점 최종 검토. |

### 6.2 Phase별 상세 구성

#### Ideation

```
Panel:
  - Innovator  (GPT-4o,  0x)  — 비정형 해법 탐색
  - Analyst    (GPT-4.1, 0x)  — 구조적 분석
  - Explorer   (GPT-5 mini, 0x)  — 선례 활용
  - Driver     (Grok Fast 1, 0x)  — 실행 경로 중심

Judge:
  - Analyst    (Claude Sonnet 4, 1x) — 종합 평가 + 최종 결론

총 비용: 0 + 0 + 0 + 0 + 1 = 1 premium request
```

#### Spec

```
Drafter:
  - Pragmatist (GPT-4.1, 0x) — 구조적 초안 작성

Critic:
  - Perfectionist (GPT-5 mini, 0x) — 누락/엣지케이스 비평

Judge:
  - Analyst (Claude Sonnet 4.5, 1x) — 최종 스펙 확정

총 비용: 0 + 0 + 1 = 1 premium request
```

#### Test

```
Drafter:
  - Perfectionist (GPT-5.1-Codex-Mini, 0.33x) — 테스트 코드 작성

Critic:
  - Sentinel (GPT-4.1, 0x) — 실패 시나리오 탐색

Judge:
  - Analyst (GPT-5.1-Codex, 1x) — 최종 테스트 확정

총 비용: 0.33 + 0 + 1 = 1.33 premium requests
```

#### Implementation

```
Lead:
  - Pragmatist (GPT-4.1, 0x) — 코드 작성

Reviewer:
  - Perfectionist (GPT-5.1-Codex-Mini, 0.33x) — 코드 리뷰

총 비용: 0 + 0.33 = 0.33 premium request
```

#### Debug

```
Analyst:
  - Analyst (GPT-4.1, 0x) — 에러 분석

Hypothesizer:
  - Sentinel (GPT-5 mini, 0x) — 원인 가설 (역산 사고)

Verifier:
  - Pragmatist (Claude Haiku 4.5, 0.33x) — 가설 검증

총 비용: 0 + 0 + 0.33 = 0.33 premium request
```

#### Review

```
Panel:
  - Analyst      (GPT-4o, 0x)      — 구조적 검토
  - Perfectionist (GPT-4.1, 0x)     — 디테일 검토
  - Sentinel     (GPT-5 mini, 0x)   — 위험 탐지
  - Explorer     (Grok Fast 1, 0x)  — 선례 대비

Judge:
  - Analyst (Gemini 2.5 Pro, 1x) — 긴 컨텍스트 활용 전체 점검

[선택] 최종 심판:
  - Analyst (Claude Opus 4.6, 3x) — 아키텍처 결정만

총 비용: 0+0+0+0+1 = 1 (Opus 없이) / 4 (Opus 포함)
```

### 6.3 전체 파이프라인 비용

| 시나리오 | Ideation | Spec | Test | Impl | Debug | Review | 합계 |
|----------|---------|------|------|------|-------|--------|------|
| **기본 (Opus 없이)** | 1 | 1 | 1.33 | 0.33 | 0.33 | 1 | **~5** |
| **Opus 1회 (Review)** | 1 | 1 | 1.33 | 0.33 | 0.33 | 4 | **~8** |
| **전부 Free** | 0 | 0 | 0 | 0 | 0 | 0 | **0** |

---

## 7. Model Orchestra — 모델 다양성 전략

### 7.1 핵심 인사이트

**"다른 모델 = 진짜 다른 관점"**

기존 멀티 에이전트 프레임워크는 같은 모델에 다른 persona를 부여한다. 하지만 Free 모델이 5개나 있으므로, 실제로 다른 모델을 쓰면 자연스러운 관점 분화가 발생한다.

각 모델은 학습 데이터, 아키텍처, 편향이 다르다. 같은 프롬프트에 대해 GPT-4o, GPT-4.1, GPT-5 mini, Grok Fast 1, Raptor mini는 서로 다른 우선순위, 위험 인식, 해결 접근법을 제시한다.

추가로 **벤더 다양성** — GPT(OpenAI), Claude(Anthropic), Gemini(Google), Grok(xAI), Raptor 5개 벤더가 섞이면 특정 벤더의 편향이 상쇄된다.

### 7.2 5-Tier 모델 분류

| Tier | Multiplier | 모델 | 역할 |
|------|-----------|------|------|
| **Free** | 0x | GPT-4.1, GPT-4o, GPT-5 mini, Grok Fast 1, Raptor mini | 토론 참가자 (무제한) |
| **Cheap** | 0.33x | Claude Haiku 4.5, Gemini 3 Flash, GPT-5.1-Codex-Mini | 검증자, 코드 리뷰 |
| **Standard** | 1x | Claude Sonnet 4/4.5, Gemini 2.5/3 Pro, GPT-5~5.2, Codex 계열 | 합성자 (Judge) |
| **Premium** | 3x | Claude Opus 4.5, Claude Opus 4.6 | 최종 심판 (선택적) |
| **Ultra** | 9x | Claude Opus 4.6 fast mode | 비상용 (기본 비활성) |

### 7.3 역할별 modelPreferences 매핑

MCP Sampling 힌트로 모델 선택을 간접 유도:

| 역할 | costPriority | speedPriority | intelligencePriority | hints |
|------|-------------|--------------|---------------------|-------|
| Panel 참가자 | 1.0 | 0.7 | 0.3 | gpt-4o, gpt-4.1, gpt-5-mini, grok-fast-1 |
| 검증자 | 0.8 | 0.8 | 0.5 | claude-haiku, gemini-flash |
| Judge (합성자) | 0.3 | 0.3 | 1.0 | claude-sonnet, gpt-5.1 |
| 코드 전문가 | 0.5 | 0.5 | 0.8 | gpt-5.1-codex, gpt-5.3-codex |
| 최종 심판 | 0.0 | 0.0 | 1.0 | claude-opus |

### 7.4 전략 프리셋

| 전략 | Panel | 검증자 | Judge | 심판 | 비용/파이프라인 |
|------|-------|--------|-------|------|---------------|
| `free-only` | Free만 | Free만 | Free만 | 없음 | **0** |
| `balanced` | Free | Cheap | Standard | 없음 | **~5** |
| `quality` | Free+Cheap | Standard | Standard | Opus 1회 | **~12** |
| `max` | Cheap+Standard | Standard | Premium | Opus 매 phase | **~30+** |

### 7.5 특수 모델 활용

| 모델 | 특수 활용 시나리오 |
|------|------------------|
| **Grok Fast 1** | 초안 빠르게 여러 개 뽑기 (속도 우선 반복) |
| **GPT-5.1-Codex-Max** | 대규모 코드베이스 분석, 긴 사고 체인 |
| **Gemini 2.5/3 Pro** | 긴 컨텍스트 윈도우. 전체 코드 리뷰, 대규모 스펙 분석 |
| **Raptor mini** | 실험적 관점 (Preview — 기본 비활성) |
| **Opus 4.6 fast (9x)** | 비상용. 프로덕션 장애 대응 등 긴급 상황에서만 |

---

## 8. 실행 아키텍처

### 8.1 Bun Worker 기반 에이전트 격리

```
Main Thread (Orchestrator)
  │
  ├── MCP Connection (stdio) ←→ Copilot Client
  │
  ├── Message Router
  │     └── 권한(Authority)에 따라 메시지 필터링/라우팅
  │
  ├── Convergence Detector
  │     └── 수렴 조건 체크 (§5.4)
  │
  ├── Worker A (Agent A) ──postMessage──┐
  ├── Worker B (Agent B) ──postMessage──┤
  ├── Worker C (Agent C) ──postMessage──┼→ Main → MCP Sampling → Client
  └── Worker D (Agent D) ──postMessage──┘
```

### 8.2 MCP Sampling 중개

Worker에서 직접 MCP Sampling을 호출할 수 없다 (stdio는 main thread 소유).

```typescript
// Worker → Main: sampling 요청
postMessage({
  type: 'sampling_request',
  payload: {
    prompt: string,
    systemPrompt: string,       // R²AP 인코딩
    modelPreferences: object,   // §7.3 매핑
  }
});

// Main → MCP Client: JSON-RPC sampling/createMessage
// 4개 Worker의 요청을 동시에 전송 (JSON-RPC는 비동기)

// Main → Worker: 응답 전달
worker.postMessage({
  type: 'sampling_response',
  payload: { content: string }
});
```

### 8.3 라운드 실행 시퀀스

```
1. Orchestrator가 Phase config에 따라 Worker 생성
   - 각 Worker에 R²AP 설정 전달 (system prompt 구성)

2. Round 0 (Independent):
   - 모든 Worker에 문제 컨텍스트 전달
   - 각 Worker가 sampling 요청 → Main이 N개 동시 전송
   - 응답 수신 → 각 Worker에 전달
   - 각 Worker가 AgentMessage 생성 → Main에 post

3. Round 1..N (Debate):
   - Main이 이전 라운드 메시지를 Authority에 따라 필터링 후 broadcast
   - 각 Worker가 이전 메시지 + 본인 페르소나로 critique 생성
   - sampling 요청 → 응답 → AgentMessage 생성

4. 수렴 감지:
   - Main의 ConvergenceDetector가 매 라운드 후 체크
   - converged? → Judge 단계로

5. Verdict:
   - Main이 전체 대화 로그를 익명화 (§5.6)
   - Judge Worker에 전달 → Judge가 verdict 생성
   - 최종 결과를 사용자에게 반환

6. Cleanup:
   - 모든 Worker 종료
   - 토론 로그를 카드 시스템에 연동 (§9)
```

### 8.4 권한의 아키텍처적 강제

R²AP의 **권한(Authority)**이 Worker 간 메시지 라우팅 규칙으로 구현된다:

```typescript
// Message Router 내부
function routeMessages(
  messages: AgentMessage[],
  targetAgent: AgentConfig
): AgentMessage[] {
  switch (targetAgent.authority.access) {
    case 'independent':
      // Panel Round 0: 다른 에이전트 메시지 접근 불가
      return [];

    case 'all_previous':
      // Panel Round 1+: 이전 라운드 전체
      return messages.filter(m => m.round < currentRound);

    case 'full_log':
      // Judge: 전체 대화 로그 (익명화)
      return anonymizeForJudge(messages);

    case 'predecessor_only':
      // Chain 구조: 바로 앞 단계 출력만
      return messages.filter(m => m.agentId === predecessorId);
  }
}
```

### 8.5 LLM Provider Fallback Chain

```
1순위: MCP Sampling (Copilot의 LLM — 사용자 키 불필요)
2순위: Ollama (로컬 LLM — GPU 있으면 14B+ 모델)
3순위: AI SDK + API key (사용자 제공 키)
```

---

## 9. 카드 시스템 연동

### 9.1 토론 → 카드 생명주기

카드 시스템(PLAN.md)과 멀티 에이전트의 시너지:

```
[사용자] "이 기능 설계해줘"
    │
    ▼
[Ideation Phase] 토론 → Judge verdict
    │
    ▼
[카드 자동 생성] card_create(type='spec', status='draft', ...)
    │                토론 로그를 card body에 첨부
    ▼
[사용자 승인] card_update_status(key, 'accepted')
    │
    ▼
[Spec Phase] 카드 내용 기반 스펙 작성 → 카드 업데이트
    │
    ▼
[Test Phase] 스펙 기반 테스트 설계 → 카드 상태 'implementing'
    │
    ▼
[Implementation Phase] 구현 → @see 링크 삽입
    │
    ▼
[Review Phase] 최종 검토 → 카드 상태 'implemented'
    │
    ▼
[zp mcp verify] 무결성 자동 검증
```

### 9.2 토론 로그 보존

토론의 전체 대화 로그는 카드의 body에 축약 형태로 첨부:

```markdown
---
key: spec::feature/multi-agent
type: spec
status: draft
keywords: [multi-agent, orchestration, discussion]
---

## Summary
(Judge의 verdict)

## Discussion Log
### Round 0 — Independent Proposals
- Agent-A (Innovator): ...
- Agent-B (Analyst): ...
- Agent-C (Explorer): ...
- Agent-D (Driver): ...

### Round 1 — Debate
- Agent-A: agrees with B on ..., disagrees with C on ...
- ...

### Verdict
(Judge의 최종 결론)
```

---

## 10. 설정 구조

### 10.1 설계 원칙

**"사용자는 what을 설정하고, 시스템이 how를 결정한다"**

3단계 자유도로 설정 표면을 제공한다:

| Layer | 대상 | 자유도 |
|-------|------|--------|
| **L1 — Strategy** | 대부분의 사용자 | `strategy` 하나만 설정. 나머지 전부 자동. |
| **L2 — Phase Override** | 중급 사용자 | Phase별 활성화/비활성화, 에이전트 persona·modelTier 교체 |
| **L3 — Convergence Tuning** | 고급 사용자 | 수렴 조건 임계값, 라운드 한계 |

### 10.2 사용자 조절 가능 vs 시스템 강제

| 항목 | 조절 가능? | 이유 |
|------|----------|------|
| Strategy preset | ✅ | 비용/품질 밸런스 |
| Phase 활성화/비활성화 | ✅ | 파이프라인 길이 |
| Persona 배치 | ✅ (enum 목록에서 택1) | 관점 다양성 조합 |
| Model tier | ✅ (enum 목록에서 택1) | 비용 vs 판단 품질 |
| Max rounds | ✅ | 토론 깊이 vs 시간 |
| Convergence 임계값 | ✅ | 수렴 민감도 |
| **Responsibility (책임)** | ❌ | Persona의 thinking pattern에 내장. 변경 시 토론 품질 보장 불가 |
| **Authority (권한)** | ❌ | Topology에서 자동 결정. Panel → 제한적, Judge → 전체 |
| **토론 프로토콜** | ❌ | 메시지 구조, 익명화, tit-for-tat — 논문 기반 설계 |
| **Thinking Pattern** | ❌ | 페르소나 카탈로그 §4에서 고정. 핵심 행동 지침 |
| **Topology** | ❌ | Phase 성격에 따라 시스템 결정 (Ideation→Panel+Judge, Spec→Chain 등) |

### 10.3 TypeScript 타입 정의

```typescript
// ═══════════════════════════════════════════════
//  Enums — 사용자가 선택할 수 있는 옵션 (모두 고정 목록)
// ═══════════════════════════════════════════════

/** 전략 프리셋. L1에서 이것만 설정하면 나머지 전부 자동. */
type Strategy = 'free-only' | 'balanced' | 'quality' | 'max' | 'custom';

/** 페르소나 — 에이전트의 사고 방식. §4 카탈로그 참조. */
type Persona =
  | 'innovator'      // 비정형 해법 탐색 (Belbin Plant)
  | 'analyst'        // 냉정한 논리 분석 (Belbin Monitor Evaluator)
  | 'driver'         // 실행 속도 최우선 (Belbin Shaper)
  | 'pragmatist'     // 최소 변경, 일관성 (Belbin Implementer)
  | 'perfectionist'  // 엣지케이스 집착 (Belbin Completer Finisher)
  | 'explorer'       // 선례 활용 (Belbin Resource Investigator)
  | 'sentinel';      // 실패 시나리오 역산 (Black Hat + Inversion)

/** 모델 비용 등급. MCP Sampling의 modelPreferences로 변환됨. */
type ModelTier = 'free' | 'cheap' | 'standard' | 'premium' | 'ultra';

/** 개발 파이프라인 phase. */
type PhaseName =
  | 'ideation'        // 발산적 사고
  | 'spec'            // 스펙 정제
  | 'test'            // 테스트 설계
  | 'implementation'  // 코드 작성
  | 'debug'           // 원인 분석
  | 'review';         // 최종 검토

// ═══════════════════════════════════════════════
//  설정 구조
// ═══════════════════════════════════════════════

/** 에이전트 슬롯. phase 내 하나의 에이전트 위치를 정의. */
interface AgentSlot {
  /** 사고 방식. 7개 enum 중 택1. */
  persona: Persona;
  /** 비용 등급. 생략 시 strategy preset에서 결정. */
  modelTier?: ModelTier;
}

/** Phase별 커스텀 구성. strategy="custom"일 때 사용. */
interface PhaseConfig {
  /** 이 phase를 실행할지 여부. 기본 true. */
  enabled?: boolean;
  /** 토론 참가 에이전트 목록. 생략 시 strategy 기본 구성 사용. */
  agents?: AgentSlot[];
  /** 합성자(Judge) 에이전트. 생략 시 strategy 기본 구성 사용. */
  judge?: AgentSlot;
}

/** 수렴 조건 임계값. L3 고급 설정. */
interface ConvergenceConfig {
  /** agreements > disagreements × N이면 합의로 판정. 기본 2.0. */
  consensusRatio?: number;
  /** 평균 confidence가 이 값을 넘으면 수렴. 기본 0.8. */
  confidenceThreshold?: number;
  /** 이전 라운드 대비 newPoints가 이 비율 이하로 떨어지면 수렴. 기본 0.5. */
  diminishingRatio?: number;
  /** newPoints=0인 라운드가 이 횟수 연속이면 교착으로 판정. 기본 2. */
  staleRounds?: number;
}

/** 멀티에이전트 설정. zipbul.jsonc의 "agents" 키. */
interface AgentsConfig {
  /** L1 — 전략 프리셋. 이것만 설정하면 나머지 전부 자동. */
  strategy: Strategy;

  /** L2 — Phase별 커스텀. strategy="custom"이거나 개별 phase를 오버라이드할 때. */
  phases?: Partial<Record<PhaseName, PhaseConfig>>;

  /** L3 — 라운드 한계. adaptive break의 상한선. */
  maxRounds?: {
    /** Panel+Judge 구조의 최대 토론 라운드. 기본 3. */
    panel?: number;
    /** Chain 구조의 최대 반복. 기본 2. */
    chain?: number;
  };

  /** L3 — 수렴 조건 임계값. */
  convergence?: ConvergenceConfig;
}
```

### 10.4 zipbul.jsonc 설정 예시

#### L1 — Strategy만 (대부분의 사용자)

```jsonc
{
  "agents": {
    "strategy": "balanced"
  }
}
```

#### L2 — Phase Override (중급 사용자)

```jsonc
{
  "agents": {
    "strategy": "custom",
    "phases": {
      "ideation": {
        "agents": [
          { "persona": "innovator",  "modelTier": "free" },
          { "persona": "analyst",    "modelTier": "free" },
          { "persona": "explorer",   "modelTier": "free" }
        ],
        "judge": { "persona": "analyst", "modelTier": "standard" }
      },
      "spec": {
        "agents": [
          { "persona": "pragmatist",    "modelTier": "free" },
          { "persona": "perfectionist", "modelTier": "free" }
        ],
        "judge": { "persona": "analyst", "modelTier": "standard" }
      },
      "test":           { "enabled": true },
      "implementation": { "enabled": true },
      "debug":          { "enabled": true },
      "review":         { "enabled": false }
    }
  }
}
```

#### L3 — Convergence Tuning (고급 사용자)

```jsonc
{
  "agents": {
    "strategy": "balanced",
    "maxRounds": { "panel": 4, "chain": 3 },
    "convergence": {
      "consensusRatio": 2.5,
      "confidenceThreshold": 0.85,
      "diminishingRatio": 0.4,
      "staleRounds": 3
    }
  }
}
```

### 10.5 Strategy Preset 기본 구성 매핑

각 preset이 자동으로 결정하는 기본 구성:

| 설정 항목 | `free-only` | `balanced` | `quality` | `max` |
|----------|-------------|-----------|----------|-------|
| Panel agents modelTier | free | free | free + cheap | cheap + standard |
| Judge modelTier | free | standard | standard | premium |
| 최종 심판 (Opus) | 없음 | 없음 | Review 1회 | 매 phase |
| maxRounds.panel | 3 | 3 | 4 | 5 |
| maxRounds.chain | 2 | 2 | 3 | 3 |
| 예상 비용/파이프라인 | **0** | **~5** | **~12** | **~30+** |

### 10.6 CLI Surface

```
zipbul agents discuss <topic>        # 전체 파이프라인 실행 (Ideation → Review)
zipbul agents ideate <topic>         # Ideation phase만
zipbul agents spec <card-key>        # 카드 기반 Spec phase
zipbul agents test <card-key>        # 카드 기반 Test phase
zipbul agents review <card-key>      # 카드 기반 Review phase
zipbul agents debug <error-context>  # Debug phase

# 옵션
--strategy <preset>     # 전략 프리셋 오버라이드
--max-rounds <n>        # 최대 라운드 오버라이드
--verbose               # 중간 토론 과정 실시간 출력
--dry-run               # 카드 생성 없이 토론만
```

---

## 11. 미결정 사항

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| U1 | MCP Sampling 동시 N개 처리 지원 여부 (Copilot 구현체) | 미확인 | JSON-RPC상 가능하나 구현체가 직렬화할 수 있음. Worker 구조의 가치는 직렬화되어도 유지. |
| U2 | Copilot의 `modelPreferences` hints 존중 여부 | 미확인 | 무시되어도 priority 값으로 유사 tier 모델 선택됨. |
| U3 | Free 모델의 긴 system prompt(R²AP) 수행 능력 | 구현 시 검증 | 페르소나 지시가 너무 길면 Free 모델이 무시할 가능성. 압축 필요할 수 있음. |
| U4 | Ollama fallback 시 모델 다양성 확보 방안 | 미정 | llama3, qwen, deepseek-r1 등으로 벤더 다양성 유지 가능. |
| U5 | 토론 로그 → 카드 body 자동 요약 방식 | 미정 | Judge verdict를 그대로 쓸지, 별도 요약 단계를 둘지. |
| U6 | `agents/` 도메인의 CLI 내 정확한 배치 | 미정 | PLAN.md §32 shouldRegister 패턴 적용 예정. |

---

## 12. 결정 로그

| # | 결정 | 해결 | 근거 |
|---|------|------|------|
| D1 | IDE 종속 vs IDE 무관 | IDE 무관 (MCP 기반) | MCP Sampling은 어떤 MCP client든 동작 |
| D2 | 별도 프로젝트 vs CLI 포함 | CLI의 `agents/` 도메인 | shouldRegister 패턴 + 설정 기반 활성화 |
| D3 | Docker vs 단일 프로세스 | Bun Worker (단일 프로세스 내 병렬) | Docker 불필요. 에이전트 격리 + 권한 강제 + 병렬 실행 |
| D4 | LLM Provider | MCP Sampling (1순위) → Ollama → AI SDK + key | 사용자 키 불필요가 핵심 가치 |
| D5 | 에이전트 정체성 축 | R²AP 4축 (역할+책임+권한+페르소나) | Zhang et al. — trait+thinking pattern이 역할만보다 효과적 |
| D6 | 페르소나 설계 기반 | Belbin Team Roles + De Bono + Inversion Thinking | 논문 기반 행동 지침 형태. 추상적 성격 아닌 구체적 사고 절차. |
| D7 | 조직 구조 | Flat Panel + Elevated Judge (2-tier) | 패널 수평 + Judge만 결정권. 학술 논문 심사 모델. |
| D8 | Phase별 구조 고정 vs 적응 | Phase-Adaptive Structure | 발산 phase(Ideation/Review)는 Panel+Judge, 수렴 phase(Spec/Test/Debug)는 Chain |
| D9 | 순차 vs 병렬 | 라운드 기반 반동기 (라운드 내 병렬, 라운드 간 동기) | Bun Worker로 병렬 실행 + 동기화 장벽으로 컨텍스트 일관성 |
| D10 | 같은 모델 persona vs 다른 모델 | 다른 모델 = 자연적 관점 분화 (Model Orchestra) | 벤더 다양성에 의한 편향 상쇄 |
| D11 | 수렴 메커니즘 | Adaptive Break (5가지 수렴 조건) | Liang et al. — 고정 라운드 불가, 적응적 종료 필요 |
| D12 | Judge 공정성 | 익명화 (agentId 마스킹) | Liang et al. — 다른 모델 간 Judge 편향 방지 |
| D13 | 반박 수준 | Modest Tit for Tat (steel man 후 반박) | Liang et al. — 과격→발산, 순종→groupthink |
| D14 | 성격/특성의 위상 | R²AP의 독립 4번째 축 (Persona) | 연구 기반 체계적 설계가 전제 → 1줄 병합이 아닌 독립 축 |
| D15 | 비용 전략 | "토론은 싸게, 결론만 비싸게" + 4개 전략 프리셋 | Free 모델 다수(토론) + Standard(합성) + Premium(선택적 심판) |
| D16 | firebat 배치 | 별도 패키지 (현행 유지). MCP tool로 연동. | 범용 도구 + 의존성 무게 + 릴리스 독립성. zipbul에서 MCP tool call로 호출. |
| D17 | 에이전트 설정 스키마 | 3-Layer (Strategy → Phase Override → Convergence Tuning) + enum 기반 옵션 | "사용자는 what, 시스템이 how". Responsibility/Authority/Topology/ThinkingPattern은 시스템 강제. |
