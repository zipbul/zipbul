# PROBLEM.md — 코드 리뷰 발견 사항

프레임워크 레벨 파이프라인 + 미들웨어 실행 구조 리팩토링 후 코드 리뷰에서 발견된 이슈 목록.
이 PR에서 도입된 문제만 기록한다. Pre-existing 이슈는 별도 구분.

---

## CRITICAL — 즉시 수정

### 1. `assertValidPhaseId` 성공 시 return 누락

**위치**: `packages/cli/src/compiler/analyzer/adapter-spec-resolver.ts:831-843`

```ts
private assertValidPhaseId(phaseId: string, context: string, field: string): Result<void, Diagnostic> {
  if (phaseId.length === 0) {
    return err(buildDiagnostic({ ... }));
  }
  if (phaseId.includes(':')) {
    return err(buildDiagnostic({ ... }));
  }
  // ← 여기서 아무것도 반환하지 않음. undefined 반환.
}
```

**왜 문제인가**: 반환 타입이 `Result<void, Diagnostic>`인데, 검증 통과 시 `undefined`를 반환한다. 호출부에서 `isErr(result)`로 검사하므로 `undefined`는 `err`가 아니라 우연히 동작하지만, `Result` 패턴의 계약을 위반한다. 향후 `isOk()` 검사를 추가하거나 Result를 구조 분해하면 런타임 에러 발생.

**수정**: 마지막에 `return ok(undefined)` 추가.

---

### 2. deep import 금지 위반 (`@zipbul/core/src/`)

**위치**: `packages/http-adapter/src/zipbul-http-adapter.ts:6-10`

```ts
import type {
  ClassMetadata as CoreClassMetadata,
  ConstructorParamMetadata as CoreConstructorParamMetadata,
  DecoratorMetadata as CoreDecoratorMetadata,
} from '../../core/src/injector/types';
```

**왜 문제인가**: CLAUDE.md 규칙 "패키지 외부 노출은 `index.ts` Facade 하나뿐. deep import(`@zipbul/*/src/`) 금지". 상대 경로 `../../core/src/`는 `@zipbul/core`의 내부 구현에 직접 의존한다. `@zipbul/core`가 내부 파일 구조를 변경하면 이 import이 깨진다.

**수정**: `@zipbul/core/index.ts`에서 해당 타입들을 re-export하고, import 경로를 `@zipbul/core`로 변경.

---

## HIGH — 머지 전 수정

### 3. `addErrorFilters`가 배열 mutation 사용

**위치**: `packages/common/src/interfaces.ts:45-47`

```ts
addErrorFilters(filters: readonly ExceptionFilterToken[]): this {
  this.errorFilterTokens.push(...filters);  // ← mutation
  return this;
}
```

**왜 문제인가**: 같은 클래스의 `addMiddlewares`는 spread로 새 배열을 생성하는 불변 패턴을 사용한다. 동일 클래스 내에서 두 메서드가 서로 다른 mutation 전략을 쓰면 유지보수자가 의도를 오해한다. CLAUDE.md "불변성: 인자 객체/배열 변형 금지" 원칙과도 불일치.

**수정**: `this.errorFilterTokens = [...this.errorFilterTokens, ...filters]`로 통일.

---

### 4. `as string[]` type assertion

**위치**: `packages/cli/src/compiler/analyzer/adapter-spec-resolver.ts:507`

```ts
return adapterIds as string[];
```

**왜 문제인가**: CLAUDE.md "`as` 단언 금지. `satisfies` 권장". 직전 루프에서 각 원소가 string인지 검증하지만, TypeScript 타입 시스템에 그 정보가 전달되지 않아 `as`로 우회한다. `as`는 런타임 안전성을 보장하지 않으므로, 타입 가드 패턴으로 좁혀야 한다.

**수정**: 검증 루프에서 `string[]`로 타입이 좁혀지도록 타입 가드 함수를 사용하거나, 검증된 결과를 `string[]` 변수에 수집.

---

### 5. backward compat fallback (`adapterSpec`) 테스트 없음

**위치**: `packages/cli/src/compiler/analyzer/adapter-spec-resolver.ts:181-183`

```ts
// Backward compatibility: also search for legacy 'adapterSpec' export name
if (Object.prototype.hasOwnProperty.call(exportedValues, 'adapterSpec')) {
  return { value: exportedValues.adapterSpec, sourceFile: filePath };
}
```

**왜 문제인가**: 이 코드 경로를 검증하는 테스트가 없다. 1729줄의 테스트 파일에서 모든 케이스가 `adapterDefinition`만 사용한다. 테스트되지 않은 코드는 리그레션 보호가 없으므로, 누군가 이 분기를 실수로 삭제하거나 변경해도 감지할 수 없다. legacy 어댑터 패키지가 이 fallback에 의존하면 조용히 깨진다.

**수정**: `should resolve legacy adapterSpec export for backward compatibility` 테스트 케이스 추가.

---

### 6. `console.log` 프로덕션 코드에 잔존

**위치**: `packages/http-adapter/src/route-handler.ts:752`

```ts
console.log(`[RouteHandler] Resolved Lazy Type: ${String(type)} ->`, resolved);
```

**왜 문제인가**: 디버깅용 `console.log`가 프로덕션 코드에 남아 있다. 프레임워크 사용자의 표준 출력을 오염시키고, 구조화된 로깅(`@zipbul/logger`)을 우회한다. CLAUDE.md "TODO, FIXME 절대 금지" 정신과 같은 맥락으로, 디버그 출력은 커밋하면 안 된다.

**수정**: 삭제하거나 `this.logger.debug()`로 교체.

---

## MEDIUM — 수정 권장

### 7. `ZipbulAdapter` class가 `interfaces.ts`에 위치 (1-class-1-file 위반)

**위치**: `packages/common/src/interfaces.ts:14-75`

**왜 문제인가**: CLAUDE.md "1 class 1 file" 규칙. `ZipbulAdapter`는 62줄, 5개 메서드를 가진 abstract class로, interface와 성격이 다르다. `interfaces.ts`에 class가 있으면 파일명과 내용이 불일치하고, 해당 파일을 import하는 모든 곳에서 class의 런타임 코드까지 로드된다.

**수정**: `packages/common/src/adapter/zipbul-adapter.ts`로 분리. `index.ts`에서 re-export. 변경 범위가 크므로 후속 PR로 분리 가능.

---

### 8. `VALID_HOOKS` 하드코딩 — `MiddlewareHook` enum과 동기화 위험

**위치**: `packages/cli/src/compiler/analyzer/adapter-spec-resolver.ts:33-37`

```ts
/**
 * Framework-level middleware hook names.
 * Must be kept in sync with `MiddlewareHook` enum in `@zipbul/common`.
 */
const VALID_HOOKS = new Set(['OnReceive', 'PostParseData', 'PreHandle', 'OnComplete']);
```

**왜 문제인가**: `MiddlewareHook` enum에 새 값을 추가하면 이 상수도 함께 수정해야 한다. 주석으로 동기화를 요구하지만, 강제할 메커니즘이 없다. CLI가 `@zipbul/common`을 의존성으로 갖지 않아 직접 import이 불가능한 구조적 제약 때문에 인라인했지만, 동기화 깨짐을 방지할 장치가 필요하다.

**수정 옵션**:
- (A) CLI에 `@zipbul/common` devDependency 추가 후 import
- (B) 테스트에서 `MiddlewareHook` enum 값과 `VALID_HOOKS`를 비교하는 검증 추가
- (C) 공유 상수 파일을 별도 패키지 없이 빌드 시 생성

---

### 9. `JSON.stringify() ?? 'Unknown error'` — dead code

**위치**: `packages/http-adapter/src/zipbul-http-server.ts:205`

```ts
? (JSON.stringify(error) ?? 'Unknown error')
```

**왜 문제인가**: `JSON.stringify()`는 `null`이나 `undefined`를 반환하지 않는다. 직렬화 가능한 값이면 string을 반환하고, 순환 참조 등이면 `TypeError`를 throw한다. `??` 연산자의 우항 `'Unknown error'`는 절대 실행되지 않는 dead code이며, 코드 리뷰어에게 "JSON.stringify가 null을 반환할 수 있다"는 잘못된 인상을 준다.

**수정**: `?? 'Unknown error'` 제거. 순환 참조 대비가 필요하면 try-catch로 감싸기.

---

### 10. `MiddlewareHook` enum 멤버별 JSDoc 없음

**위치**: `packages/common/src/adapter/types.ts:12-17`

```ts
export enum MiddlewareHook {
  OnReceive = 'OnReceive',
  PostParseData = 'PostParseData',
  PreHandle = 'PreHandle',
  OnComplete = 'OnComplete',
}
```

**왜 문제인가**: enum 상단에 파이프라인 순서를 설명하는 주석은 있지만, 각 멤버가 파이프라인 어디에 위치하고 어떤 시점에 실행되는지 개별 문서가 없다. `PostParseData`가 "body 파싱 후"인지 "query 파싱 후"인지, `PreHandle`이 "Guards 후"인지 "전"인지 코드만으로는 알 수 없다. CLAUDE.md "Public API TSDoc 필수" 위반.

**수정**: 각 enum 멤버에 한 줄 JSDoc 추가. 예:
```ts
/** 요청 수신 직후, body/query 파싱 전. */
OnReceive = 'OnReceive',
/** body/query 파싱 완료 후, Guards 실행 전. */
PostParseData = 'PostParseData',
/** Guards 통과 후, Handler 실행 전. */
PreHandle = 'PreHandle',
/** Handler 완료 및 응답 전송 후. */
OnComplete = 'OnComplete',
```

---

## LOW — 후속 개선

### 11. "fire-and-forget" 주석이 실제 동작과 불일치

**위치**: `packages/http-adapter/src/zipbul-http-server.ts:195`

```ts
// 4. OnComplete (fire-and-forget)
try {
  await this.adapter.runMiddlewares(MiddlewareHook.OnComplete, context);
```

**왜 문제인가**: `await`로 완료를 기다리므로 "fire-and-forget"이 아니다. 주석이 동작을 잘못 설명하면 유지보수자가 성능 특성을 오해한다. 실제로 fire-and-forget이면 `void promise.catch()` 패턴이어야 한다.

**수정**: 주석을 "OnComplete (에러 무시, 응답 후 실행)"으로 변경하거나, 실제로 fire-and-forget이 의도라면 `await` 제거.

---

### 12. middleware barrel에서 `export *` 사용

**위치**:
- `packages/http-adapter/src/middlewares/cors/index.ts:1` — `export * from './interfaces'`
- `packages/http-adapter/src/middlewares/query-parser/index.ts:1,3` — `export * from './query-parser'`, `export * from './interfaces'`

**왜 문제인가**: CLAUDE.md "배럴: `index.ts`에 명시적 named export. `export *` 금지". `export *`는 어떤 심볼이 외부로 노출되는지 명시적이지 않고, 내부 타입이 의도치 않게 public API에 포함될 수 있다.

**수정**: `export *` → 명시적 named export로 변경.

---

### 13. `ProviderVisibility` 타입 미사용 (pre-existing, 정리 시점)

**위치**: `packages/common/src/interfaces.ts:88`

```ts
export type ProviderVisibility = 'internal' | 'exported';
```

**왜 문제인가**: codebase 전체에서 사용처가 없다. `ProviderVisibleTo` (line 173)와 역할이 겹치며, dead code를 남겨두면 신규 개발자가 혼동한다.

**수정**: 삭제. 사용처가 확인되면 복구.

---

### 14. `adapterDefinition` + `adapterSpec` 동시 export 시 무경고

**위치**: `packages/cli/src/compiler/analyzer/adapter-spec-resolver.ts:175-184`

**왜 문제인가**: 한 파일에서 `adapterDefinition`과 `adapterSpec`을 모두 export하면, `adapterDefinition`만 사용되고 `adapterSpec`는 무시된다. 마이그레이션 기간 중 사용자가 두 이름을 혼용하면 의도치 않은 동작을 발견하기 어렵다.

**수정**: 둘 다 존재할 때 `warn` 수준 진단 메시지를 emit하거나, deprecated 로그를 남기기. 마이그레이션 기간 종료 후 `adapterSpec` fallback 자체를 제거.

---

## PRE-EXISTING — 이 PR에서 도입하지 않았으나 인지 필요

| 위치 | 이슈 |
|------|------|
| `packages/common/src/adapter/types.ts:30` | `DecoratorRef`의 `any` 사용. decorator 타입 표현 한계로 `any` 필요하지만 JSDoc 근거 없음 |
| `packages/http-adapter/src/zipbul-http-server.ts` (isJsonValue) | 순환 참조/깊은 중첩 보호 없는 재귀. stack overflow 가능 |
| `packages/http-adapter/src/zipbul-http-server.ts:290` | HTTP 101 매직 넘버. 상수로 추출 필요 |
| `packages/http-adapter/src/middlewares/cors/cors.middleware.ts:75` | `HttpMethod.Options as string` — string enum인데 불필요한 assertion |
