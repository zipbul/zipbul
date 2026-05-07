# Middleware Library Compiler — 책임 명세

> 미들웨어 라이브러리 패키지 (`zb build --lib`) 가 컴파일러로서 수행해야 할 모든 일.
> 어댑터 컴파일러 (`ADAPTER_COMPILER.md`) 와 짝을 이루는 두 번째 컴파일러 — 어댑터는 *protocol wire format*, 미들웨어 라이브러리는 *cross-cutting 기능* 을 책임진다.

**Branch**: `fix/cli-js-bundle-bin`. **Baseline (현 시점)**: typecheck clean / unit `1873 pass` / integration `147 pass` / e2e `370 pass` / smoke `1 pass`.

상태 표기 — Section A~F 본문에서 사용:
- ✅ 완료. 코드/문서 머지 + 회귀 baseline 통과.
- 🟡 부분 구현. 무엇이 빠졌는지 항목 본문에 명시.
- ⬜ 미착수.
- ❌ 명시 거부.

---

## 0. 컨텍스트 + 정책

### 0.0 미들웨어 컴파일러가 왜 존재하는가

zipbul 의 *cross-cutting concern* (Cookie 파싱 / Body 파싱 / Compression / Request ID / Trust proxy / ETag / Leader election / Rate limiting 등) 은 어댑터 본체의 책임이 아니다 (`ADAPTER_COMPILER.md` Section 0.1 — Adapter Purity). 사용자가 직접 `defineMiddleware()` 로 작성하거나, 별도 npm 패키지로 분리해 `zb build --lib` 로 컴파일한 라이브러리를 import 해서 사용한다.

미들웨어 라이브러리 패키지 컴파일의 핵심 책임 = **augment 의 정적 노출**. 미들웨어 factory 가 `ctx.to(HttpContext).request.cookie = parsed` 같은 형태로 Context 를 augment 할 때, 그 augment 정보를 `__augments` IR 으로 JS 산출물에 주입 + `dist/index.d.ts` 의 declaration merging 으로 공개. 사용자 코드의 `ctx.request.cookie` 가 type-safe + AOT 분석 가능.

어댑터처럼 manifest tree 를 만들지 않는다 — 미들웨어 라이브러리는 *런타임 import + 타입 augment* 두 축만 emit. 사용자 앱 빌드 (`zb build`) 가 미들웨어 라이브러리의 dist/index.js 를 직접 import 해서 사용.

### 0.1 정책

- **`zipbul.kind === 'middleware'` 강제**: `zb build --lib` 는 본 kind 만 컴파일. 다른 kind 또는 kind 누락 시 hard error. 어댑터 ↔ 미들웨어 mutual exclusion 자동.
- **`defineX` 호출 shape 강제**: `defineMiddleware / defineGuard / defineExceptionFilter / defineAdapter / defineModule` 모든 호출은 *반드시* top-level `export const NAME = defineX(...)` 형태. 다른 모든 위치 (비-export, let/var, 중첩 호출) 는 CONTRACT 에러. 어댑터 컴파일러와 동일 정책 — 공유 validator (`packages/cli/src/compiler/define-call-shape.ts`).
- **Augment 1 차 시민**: 미들웨어 라이브러리가 emit 하는 `__augments` / `__contextOps` IR + declaration merging 은 사용자 앱 빌드의 정적 분석 (`MiddlewareAugmentCollector` / `validateContextDependencies`) 의 입력.
- **CommonJS 미지원**: ESM only. `package.json.type === 'module'` 강제.
- **bun 우선**: `Bun.build` (target=bun, format=esm, packages=external).

### 0.2 회귀 baseline

```bash
bunx tsc --noEmit
bun run test:unit          # 1873
bun run test:integration   # 147
bun run test:e2e           # 370
bun run test:smoke         # 1
```

---

## A. Front-end — 소스 수집·파싱

1. ✅ 패키지의 모든 `.ts` 소스 파일 수집 (`*.spec.ts` / `*.test.ts` / `*.d.ts` 제외) — `lib-build.ts` 의 Glob `**/*.ts` + 필터.
2. ✅ `package.json` 로드 — `resolveLibBuildConfig`.
3. ✅ `package.json#name` required.
4. ✅ `package.json#zipbul.kind === 'middleware'` 강제 — `validateMiddlewareKind`. 위반 시 CONTRACT.
5. ✅ source 디렉토리 자동 감지 — `package.json#source` field > `src/` > `lib/` > 에러.
6. ✅ `parseSource` 단일 진입점 (`@zipbul/gildash`).

## B. 정적 분석 — defineX shape 검증

7. ✅ `defineMiddleware / defineGuard / defineExceptionFilter / defineAdapter / defineModule` 호출이 모두 top-level `export const NAME = defineX(...)` 형태인지 검증 — `validateDefineCallShape` (공유, 어댑터 컴파일러와 동일). 위반 시 CONTRACT 에러 (file:line:column + reason 분류).

## C. Augment 추출 + 변환

8. ✅ `defineMiddleware()` factory 본문에서 augment 추출 — `extractLibAugments` (`lib-augment-injector.ts`). 추출 결과:
    - `factoryText` — factory 함수 source text
    - `adaptersText` — `defineMiddleware([HttpAdapter], factory)` 패턴의 adapters 배열 source text
    - `configText` — `defineMiddleware({ factory: ... })` 패턴의 config 객체 source text
    - `augments: SerializedAugment[]` — `{ context, path, kind: 'class'|'method', type|signature }`
    - `contextOps: SerializedContextOp[]` — `{ kind: 'set'|'use'|'get', keyIdentifier }`
9. ✅ `injectAugmentsIntoSource` — 변형된 TS 소스에 `__augments` / `__contextOps` 필드 주입.
10. 🟡 augment 가 0 건이면 warning (skip 사유 표시). 사용자가 `ctx.to()` 누락한 경우 진단.

## D. Code Generation

11. ✅ TS → JS 컴파일 — `Bun.build` (target=bun, format=esm, packages=external, splitting, minify={ syntax, whitespace }).
12. ✅ 변형된 `.ts` 를 임시 디렉토리에 쓰기 → entrypoint root 로 사용 (사전 변환 패턴, 어댑터 컴파일러 영역 3 의 결정 E2 와 동일).
13. ✅ `dist/*.js` emit — entrypoint 별 unbundled (라이브러리 산출물 특성).
14. ✅ `dist/*.d.ts` emit — `tsc --declaration --emitDeclarationOnly --outDir dist` (declaration merging 포함).
15. ⬜ Source map 생성.

## E. 검증 + Self-test

16. 🟡 변형된 TS 소스의 parseability 재검증 — `parseSource` 통과 확인.
17. ⬜ JS 산출물의 import smoke (`Bun.spawn` + dynamic import).
18. ⬜ `.d.ts` 의 tsc compile smoke (별도 `tsc --noEmit` 호출).

## F. CLI Contract

19. ✅ `zb build --lib` 진입점 — `bin/build/build.command.ts:isLibMode` 분기.
20. ✅ `package.json` 에 `name` 필드 부재 시 hard error.
21. ✅ source 디렉토리 미해상 시 hard error.

---

## 책임 외 — 명시 제외

다음은 미들웨어 라이브러리 컴파일러 책임 아님:
- adapter manifest 관련 모든 항목 (`ADAPTER_COMPILER.md` Section A~M 영역).
- 사용자 앱 빌드 측 manifest 소비 (`AdapterDefinitionResolver`).
- 미들웨어 *등록* — 사용자 앱이 자기 모듈 정의에서 직접 등록.
- 런타임 미들웨어 디스패치 — `@zipbul/core` runtime 영역.
- npm publish / 배포 자동화.

---

## 잔여 작업

- Item 10 augment 0건 warning 의 진단 가이드 강화.
- Item 15 sourcemap.
- Item 17·18 self-test (import smoke + tsc compile smoke).
- 통합 e2e — 미들웨어 라이브러리 publish → 사용자 앱이 import → augment 적용된 Context 타입 받기.
- 어댑터 컴파일러와 비대칭한 부분의 정합성: atomic emit (`.staging/` 패턴), 진단 카테고리 통일, manifest 결정성 등은 라이브러리 산출물 (`*.js` / `*.d.ts`) 에는 적용 불필요지만 일관성 결정 필요 시 검토.

---

## 합계

미들웨어 라이브러리 컴파일러 = **augment 의 정적 contract** 책임. 어댑터 컴파일러와 함께 zipbul 의 두 컴파일러 시스템을 구성한다. 두 컴파일러 모두 `validateDefineCallShape` 단일 정책 위에서 동작.
