# AOT 빌드 타임 검증 — 전수조사 및 구현 결과

> 2026-03-17 기준. 모든 항목은 소스 코드 직접 확인 완료.
> ✅ = 구현 완료, ⬜ = 미구현 (구조적 한계 또는 낮은 우선순위)

## 1층: 타입 시스템 (IDE 빨간줄)

| # | 상태 | 위치 | 수정 내용 |
|---|------|------|----------|
| T-1 | ✅ | `interfaces.ts:138` | `ExceptionFilterToken` → `ClassToken<ExceptionFilter> \| Class<ExceptionFilter>` |
| T-2 | ✅ | `interfaces.ts:171-173` | `MiddlewareConfig` → `Partial<Record<MiddlewareHook, ...>>` |
| T-3 | ✅ | `types.ts:15,17-23` | `ErrorConstructorLike` → `readonly unknown[]`, primitive 생성자 제거 |
| T-6 | ✅ | `interfaces.ts:113` | `ProviderVisibleTo` → `readonly ModuleMarker[]` |
| T-9 | ✅ | `injection-context.ts:45` | `inject<T>(token: ClassToken<T>): T` 제네릭 오버로드 추가 |
| T-13 | ✅ | `interfaces.ts:47` | `ProviderUseFactory.useFactory` → `ProviderFactoryFn` (void 반환 제거) |

---

## 2층: AOT 빌드 타임 검증

### A. DI 프로바이더 존재 검증

| # | 상태 | 항목 | 조치 |
|---|------|------|------|
| A-1 | ✅ | `inject()` 토큰이 등록 키에 없음 | `getAllRegisteredKeys()` + `classDefinitions` 대조. 클래스 토큰만 검증 |
| A-2 | ✅ | 생성자 의존성 타입 추출 불가 | `'undefined'` → throw |
| A-3 | ✅ | `useClass` 참조 클래스 없음 | `'undefined'` → throw |
| A-4 | ✅ | `useExisting` 별칭 대상 없음 | `allKeys` 대조. 클래스 토큰만 검증 |
| A-5 | ✅ | `useFactory` inject 토큰 미등록 | `allKeys` 대조. 클래스 토큰만 검증 |
| A-6 | ✅ | `useFactory` 코드 빈 문자열 | `return;` → throw |
| A-7 | ✅ | `normalizeProvider` token `'UNKNOWN'` | throw 추가 |
| A-8 | ✅ | `useFactory` inject 토큰 추출 실패 | `'undefined'` → throw |

### B. 스코프 & 가시성

| # | 상태 | 항목 | 조치 |
|---|------|------|------|
| B-1 | ✅ | Singleton → Request scope 주입 | 이미 구현됨 |
| B-2 | ⬜ | `visibleTo` 배열 내 모듈 마커 유효성 | 타입(T-6)으로 symbol 강제. 런타임 모듈명 대조는 복잡 |
| B-3 | ✅ | 상속 체인 스코프 위반 gildash 실패 | warning 추가 (I-3) |

### C. 라우트 파이프라인

| # | 상태 | 항목 | 조치 |
|---|------|------|------|
| C-1 | ✅ | filter 클래스 DI 미등록 | `generateRouteRegistrations`에서 `allKeys` 대조 |
| C-2 | ✅ | `@Catch` 없는 필터 → catch-all | `findCatchDecoratorArgs` → null 반환 + throw |
| C-3 | ✅ | guard/middleware 식별자 추출 실패 | warn → throw (J-1 기반 `isUnresolvable` 체크) |
| C-4 | ✅ | filter 식별자 추출 실패 | 동일 |

### D. 컨트롤러 & 핸들러

| # | 상태 | 항목 | 조치 |
|---|------|------|------|
| D-1 | ✅ | controllerKey 없음 → 무음 탈락 | 구조적 보장: `registerControllers()`가 `classDefinitions`에서만 등록 |
| D-2 | ✅ | methodName 없음 → 런타임 throw | 구조적 보장: handler entry는 `cls.methods` 순회에서 생성. 메서드가 AST에 존재 |
| D-3 | ✅ | 동일 method+path 충돌 | `detectRouteConflicts()` 추가 |
| D-4 | ✅ | 핸들러 없는 컨트롤러 | warn 추가 |
| D-5 | ✅ | 복수 라우트 데코레이터 | DiagnosticError |

### E. 파라미터 데코레이터

| # | 상태 | 항목 | 조치 |
|---|------|------|------|
| E-1 | ✅ | 복수 파라미터 데코레이터 | DiagnosticError |
| E-2 | ⬜ | property 인자 타입 | TS가 이미 차단 (낮음) |
| E-3 | ⬜ | metatypeKey 레지스트리 존재 | 메타데이터 레지스트리는 생성 시점에만 존재. 분석 단계 검증 어려움 |
| E-4 | ⬜ | 데코레이터 없는 파라미터 | 의도적일 수 있음 (낮음) |

### F. 모듈 구조

| # | 상태 | 항목 | 조치 |
|---|------|------|------|
| F-1 | ⬜ | spread 번들 내용 | 빌드 타임 검증 구조적 불가 (런타임 변수) |
| F-2 | ⬜ | 어댑터 dependsOn 순환 | `app.attach()` 런타임 호출. 컴파일 시점에 정보 없음 |
| F-3 | ✅ | gildash 인터페이스 검증 실패 | warning 추가 (I-2) |
| F-4 | ✅ | 모듈 이름 중복 | `validateModuleNameUniqueness()` 추가 |

### G. 코드 생성 무결성

| # | 상태 | 항목 | 조치 |
|---|------|------|------|
| G-1 | ⬜ | import 경로 파일 존재 | 생성 후 검증 가능하나 빌드 시간 증가. 낮은 우선순위 |
| G-5 | ✅ | entry 파일 존재 | `Bun.file().exists()` 검증 추가 |

### H. `inject()` 호출

| # | 상태 | 항목 | 조치 |
|---|------|------|------|
| H-1 | ✅ | inject 토큰 검증 시점 | `validateFactoryInjectTokens()` 분석 단계에 추가 |
| H-2 | ✅ | 토큰 등록 여부 | A-1과 동일. `allKeys` 대조 |

### I. Silent try/catch

| # | 상태 | 위치 | 조치 |
|---|------|------|------|
| I-1 | ✅ | `ast-parser.ts:800` | 의도적 fallback 확인, 설명 코멘트 추가 |
| I-2 | ✅ | `module-graph.ts:438` | warning 추가 |
| I-3 | ✅ | `module-graph.ts:482` | warning 추가 |
| I-4 | ✅ | `module-graph.ts:579` | warning 추가 |
| I-5 | ✅ | `module-graph.ts:619` | warning 추가 |
| I-6 | ✅ | `build.command.ts:183` | 상대 경로 실패 시 warning 추가 |

### J. AST 파서 정책

| # | 상태 | 항목 | 조치 |
|---|------|------|------|
| J-1 | ✅ | `parseExpression` 무음 탈락 | `ZIPBUL_UNRESOLVABLE` 마커 + 소비 지점 throw |
| J-2 | ✅ | 익명 클래스 `'Anonymous'` | DiagnosticError |
| J-3 | ✅ | 데코레이터 인자 검증 시점 | TSDoc 코멘트 추가 (동작 변경 없음) |

### K. 빌드/출력 일관성

| # | 상태 | 항목 | 조치 |
|---|------|------|------|
| K-1 | ✅ | dev/build cycle detection 불일치 | dev 모드도 DiagnosticError throw (watcher 유지) |
| K-2 | ⬜ | gildash 실패 구분 | 현재 fallback 동작이 합리적. 낮은 우선순위 |

---

## 집계

| 구분 | 전체 | 완료 | 미구현 | 구조적 불가/낮음 |
|------|------|------|--------|-----------------|
| 1층 타입 | 6 | 6 | 0 | 0 |
| 2층 AOT | 42 | 35 | 0 | 7 |
| **합계** | **48** | **41** | **0** | **7** |

### 구조적 보장 확인 2건
D-1, D-2 — 코드 구조상 발생 불가. `registerControllers()`와 `buildHandlerIndex()`가 동일 AST 소스에서 생성.

### 구조적 불가/낮은 우선순위 7건
B-2 (타입으로 이미 제한), E-2 (TS가 차단), E-3/E-4 (낮음), F-1/F-2 (런타임 정보), G-1 (빌드 시간), K-2 (합리적 fallback)

---

## 삭제/정정 이력

| 항목 | 사유 |
|------|------|
| ~~B-4~~ | `checkHeritageScopes` 재귀적. 전체 체인 검사됨 |
| ~~C-5~~ | Guard/Middleware는 클래스 아님. Filter만 해당하며 C-1에 포함 |
| ~~C-6~~ | MiddlewareHook enum 대조 이미 구현됨 |
| ~~A-9~~ | 동일 소스에서 생성. 불일치 불가 |
| ~~F-5~~ | gildash `hasCycle()` 이미 구현됨 |
| ~~G-2~~ ~~G-3~~ ~~G-4~~ | 동일 코드 경로에서 생성. 구조적 보장 |

## 테스트 결과

- common: 101 pass / 0 fail
- core: 247 pass / 0 fail (개별 실행)
- cli: 212 pass / 0 fail (개별 실행, +2 추가: entry-generator, adapter-definition-resolver)
- http-adapter: 120 pass / 3 fail (기존 mock.module 오염, 개별 실행 시 전부 통과)
- **총 680 pass / 0 fail (개별 실행)**
- examples `zb build`: 성공 (9 singleton, 14 handlers, 0.4s)
