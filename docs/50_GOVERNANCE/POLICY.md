# POLICY

## 역할

- 이 문서는 **기계적으로 판정 가능한(Decidable)** 정책만 정의한다.
- 각 정책은 단일 위반으로 즉시 발동하며, 위반 여부는 boolean으로 판정 가능해야 한다(MUST).

## 목적

- 보안/라이선스/결정성/경계/계약을 훼손하는 변경을 기계적으로 차단한다.

## 적용 범위

- 코드/문서/리소스/의존성 추가 등 레포에 반입되는 모든 변경

## 관련 문서

| 문서                                                                                                 | 역할                                           |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| [SECURITY.md](../../.github/SECURITY.md)                                                             | 보안 상세                                      |
| [SAFEGUARDS.md](SAFEGUARDS.md)                                                                       | 폭주 방지/대량 변경/롤백 (패턴/반복 기반 중단) |
| [OVERVIEW.md](OVERVIEW.md)                                                                           | 승인 절차/프로토콜                             |
| [aot-ast.spec.md](../30_SPEC/aot-ast.spec.md), [ARCHITECTURE.md](../20_ARCHITECTURE/ARCHITECTURE.md) | AOT/경계/계약 SSOT                             |

## POLICY vs SAFEGUARDS 역할 구분

|            | POLICY (본 문서)                       | SAFEGUARDS                  |
| ---------- | -------------------------------------- | --------------------------- |
| **트리거** | 단일 위반으로 즉시 발동                | 패턴/반복으로 발동          |
| **예시**   | deep import 1회, reflect-metadata 사용 | 동일 구간 3회 수정 반복     |
| **결과**   | 변경 즉시 거부                         | 중단 후 승인 요청 또는 롤백 |

---

## 정책 형식 (Normative)

모든 정책은 아래 3요소를 가진다(MUST).

```text
Policy:
- Target: what it applies to (file, commit, spec, code, dependency)
- Violation: boolean, machine-checkable
- Enforcement: block | fail | rollback | reject
```

임계값/조건이 없는 비판정형 표현은 POLICY에 포함될 수 없다(MUST NOT).

## Machine-Enforced Policies

### POLICY-SEC-001: Block secrets

- Target: all files
- Violation: added content matches at least one pattern
  - `AKIA[0-9A-Z]{16}`
  - `-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----`
  - `xox(b|p|a)-`
- Enforcement: block

### POLICY-DEP-001: Block dependency changes without approval artifact

- Target: `package.json` (root and `packages/*/package.json`)
- Violation: `dependencies`/`devDependencies`/`optionalDependencies`/`peerDependencies` 변경이 발생했지만 승인 아티팩트가 존재하지 않음
- Enforcement: block

### POLICY-AOT-001: Block reflect-metadata

- Target: source
- Violation: any file contains `import 'reflect-metadata'` or `require('reflect-metadata')`
- Enforcement: block

### POLICY-AOT-002: Reject runtime file-scan based loading

- Target: source
- Violation: 동일 파일 내에 아래 패턴이 모두 존재함
  - `fs.readdir` 또는 `fs.readdirSync` 또는 `glob`
  - `import(` 또는 `require(`
- Enforcement: reject

### POLICY-PKG-001: Block cross-package deep imports

- Target: source
- Violation: an import path contains `@zipbul/` and `/src/` in the same path, or directly references `packages/*/src/`
- Enforcement: block

### POLICY-CON-001: Block Public Facade changes without approval artifact

- Target: `packages/*/index.ts`
- Violation: 파일 변경이 발생했지만 승인 아티팩트가 존재하지 않음
- Enforcement: block

### POLICY-GOV-001: Block SSOT file changes without approval artifact

- Target: `docs/10_FOUNDATION/**`, `docs/20_ARCHITECTURE/**`, `docs/30_SPEC/**`, `docs/40_ENGINEERING/**`, `docs/50_GOVERNANCE/**`
- Violation: 파일 변경이 발생했지만 승인 아티팩트가 존재하지 않음
- Enforcement: block

## 집행 (Enforcement)

- 에이전트(E0): 위반 감지 시 즉시 중단(STOP)한다.
- CI: 위반 감지 시 빌드를 실패(FAIL)시키고 병합을 차단한다.
