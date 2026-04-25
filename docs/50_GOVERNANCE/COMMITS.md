# COMMITS

## 커밋의 유효성 (Normative)

커밋은 시스템 내의 “법적 행위”로 취급한다.
커밋은 아래 조건을 **모두** 만족할 때만 유효하다(MUST).

1. 커밋 메타데이터(트레일러)가 형식적으로 유효하다.
2. 커밋이 참조하는 SPEC이 유효하다.

유효하지 않은 커밋은 CI에서 차단되어야 한다(MUST).

### 필수 트레일러 (Normative)

커밋 메시지 본문(body) 또는 footer에 아래 트레일러를 포함해야 한다(MUST).

```text
Specs: <path-to-spec>
Contract-Impact: breaking|non-breaking|none
```

규칙:

- `Specs:`는 1회 이상 등장해야 한다(MUST).
- `Specs:`는 여러 줄로 반복될 수 있다(MAY). 각 값은 레포 루트 기준 경로여야 한다(MUST).
  - 허용 예: `Specs: docs/30_SPEC/di.spec.md`
- `Contract-Impact:`는 정확히 1회 등장해야 한다(MUST).

### 트레일러 검증 규칙 (Normative)

- CI는 커밋에 포함된 변경 파일 목록에서 `docs/30_SPEC/*.spec.md` 변경을 계산해야 한다(MUST).
- 변경된 `docs/30_SPEC/*.spec.md` 파일은 모두 `Specs:` 트레일러로 참조되어야 한다(MUST).
- `Specs:`에 존재하지만 실제로 변경되지 않은 SPEC을 포함하는 것은 허용한다(MAY).

### SPEC 유효성 (Normative)

`Specs:`로 참조된 각 SPEC은 아래를 모두 만족해야 유효하다(MUST).

- [docs/30_SPEC/SPEC.md](../30_SPEC/SPEC.md)의 규칙을 만족한다.
- 상위 권위 문서(L1~L2)와 모순되지 않는다.

### 위반 조건 / 집행 (Normative)

- Violation: `Specs:` 누락
- Violation: `Contract-Impact:` 누락 또는 허용 값이 아님
- Violation: `Specs:`에 기재된 SPEC이 유효하지 않음
- Enforcement: fail (commitlint/CI)

## 목적

- 커밋 메시지/단위 규칙을 강제해 리뷰 가능성과 추적성을 보장한다.

## 적용 범위

- 이 레포에 생성되는 모든 커밋
- 이 규칙은 사람, CI, 자동화/에이전트가 생성하는 모든 커밋에 동일하게 적용된다.

## 참고

- PR/리뷰 절차는 [CONTRIBUTING.md](../../.github/CONTRIBUTING.md)를 따른다.

## 17. 커밋 규칙 (Commit Rules)

이 섹션은 “권장사항”이 아니다. 커밋은 리뷰 가능한 단위로만 만든다.

1. **커밋 메시지는 Conventional Commits(Git Convention)를 강제한다**
   - 형식: `type(scope): subject`
   - `type` 예: `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test`
   - `type` 선택 기준
     - `feat`: 사용자/외부 소비자가 체감하는 기능 추가 또는 동작 변경
     - `fix`: 버그 수정(오동작/예외/잘못된 상태/회귀)
     - `refactor`: 동작 변경 없이 구조 개선(리네이밍/분리/정리)
     - `perf`: 동작은 동일하지만 성능/메모리/처리량 개선
     - `test`: 테스트 추가/수정만 포함
     - `docs`: 문서만 변경
     - `style`: 포맷/정렬 등 스타일만 변경(동작/로직 변경 없음)
     - `ci`: CI 파이프라인/워크플로우 변경
     - `build`: 빌드 시스템/번들/출력 구성 변경
     - `chore`: 유지보수성 작업(위 항목에 깔끔히 속하지 않는 잡무)
     - `revert`: 이전 커밋 되돌림
   - `scope`는 가능하면 변경 범위를 명시한다.
   - 기본 scope 목록:
     - `cli`, `common`, `core`, `http-adapter`, `logger`, `examples`
     - `repo`, `config`, `plan`, `eslint`, `scripts`
     - (패키지 내부 기능 단위 scope는 금지한다.)
   - 새로운 scope가 필요하면 PR에서 함께 제안한다.
     - commitlint `scope-enum` 목록 갱신을 포함해야 한다.
   - `scope` 선택 기준
     - 변경된 코드가 특정 패키지(`packages/<pkg>/**`)에 있으면 해당 패키지 scope를 사용한다.
     - `config`: 레포 설정/도구 설정 변경(예: tsconfig/eslint/husky/commitlint/knip/bun 설정)
     - `plan`: AOT plan/registry 산출물의 규칙·포맷·결정성 관련 변경
     - `eslint`: eslint 룰/플러그인/설정 체계 자체 변경(단순 설정 값 조정은 `config`)
     - `scripts`: 루트 `scripts/**` 스크립트 변경
     - `repo`: 문서/정책/메타 등 레포 전반 변경(위 기준에 해당하지 않을 때)
   - 규칙:
     - `scope`는 1개만 사용한다(예: `cli,core` 같은 다중 scope 금지).
     - `scope`는 소문자 `kebab-case`로 작성한다.
   - `subject`는 **명령형 현재 시제(Imperative, present tense)** 로 작성하고, 마침표를 사용하지 않는다.
     - (예: “Add X”, “Fix Y”, “Refactor Z”)

2. **커밋 메시지는 영어로만 작성한다**
   - 제목(subject)과 본문(body) 모두 영어로 작성한다.
   - 금지: “fix”, “update”, “wip”, “temp” 같은 의미 없는 메시지.

3. **본문(body) 상세화를 의무로 한다**
   - subject는 변경 내용을 요약하며(What), 변경의 이유·배경·영향(Why/How/Impact)은 body에 기술한다.
   - 본문은 `Why`(왜), `What`(무엇), `How`(어떻게), `Impact`(영향)의 의미를 포함해야 한다.
   - 단, 본문을 `Why:`/`What:`/`How:`/`Impact:` 같은 **섹션 헤더로 분리해서 쓰지 않는다**.
   - **권장 구조(프로젝트 표준)**

     ```text
     feat(scope): subject

     description

     - sentence including why/what/how/impact
     - sentence including why/what/how/impact
     - sentence including why/what/how/impact
     - sentence including why/what/how/impact
     ```

     - `description`는 1줄 요약이다.
     - 각 bullet은 **자연스러운 문장**으로 작성하고, 그 문장 안에 why/what/how/impact의 의미를 담는다.
       - (예: “To prevent X, this changes A to B by doing C; this affects D because ...”)

   - **줄바꿈 규칙**: 본문의 각 줄은 100자를 넘기지 않도록 줄바꿈한다.
     - (현재 commitlint 규칙에서 body/footer max line length 100자가 강제된다.)
     - bullet/footers를 포함해 100자를 넘기지 않도록 단어 경계에서 줄바꿈한다.

   - 본문 전체 길이에는 제한을 두지 않는다.
     - 단, 과도하게 장황한 설명은 PR 설명으로 옮긴다.

   - **대규모 오픈소스에서 흔한 Footer 패턴(선택)**
     - Breaking change는 아래 중 하나로 표기한다.
       - `type(scope)!: subject`
       - 또는 footer: `BREAKING CHANGE: ...`
     - 이슈/PR 추적을 위해 footer를 사용할 수 있다.
       - `Refs: #123`
       - `Closes: #123`
     - 릴리즈 노트 목적의 요약이 필요하면 footer로 `Changes: ...`를 추가할 수 있다.
       - (Conventional Commits 표준 키워드는 아니므로, 팀 내부 규약으로만 사용한다.)

4. **커밋 전 변경 내용을 반드시 확인한다**
   - 커밋 메시지를 쓰기 전에 `git status`로 변경 파일을 확인한다.
   - `git diff`(또는 staged diff)로 실제 변경 내용을 확인한 뒤, 그 내용을 커밋 본문에 반영한다.
   - 확인 없이 “추측”으로 메시지를 작성하는 행위는 금지다.

5. **커밋 단위는 논리적 변경 1개를 기본으로 한다**
   - 서로 다른 관심사(예: 리팩토링 + 기능 추가 + 포맷팅)를 한 커밋에 섞지 마라.
   - 불가피하게 섞이면, 커밋을 분리하거나 사용자 승인 없이는 진행하지 마라.
     - “사용자 승인”은 PR 설명 또는 리뷰 코멘트로 명시되어야 한다.

6. **포맷팅/정렬/린트 수정만 포함하는 커밋은 의도를 명시한다**
   - 포맷팅/정렬/린트 수정만을 포함하는 커밋은 해당 목적이 subject와 body에 명시되어야 한다.
