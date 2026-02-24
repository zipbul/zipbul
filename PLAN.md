# CLI Result + Diagnostics + Logger 통합 리팩토링 계획

> Status: **Confirmed — 구현 대기**
> Created: 2025-02-25

---

## 목표

1. `@zipbul/result` 외부 라이브러리 도입, 내부 Result 스펙 삭제
2. CLI Diagnostics 체계화 — severity 2단계 축소, 진단 코드 전체 상수화, `DiagnosticReportError` 삭제
3. CLI에 Result 패턴 적용 — fail-fast, `DiagResult<T>` 도입
4. Logger 개선 — Transport 다중화, TestTransport, `child()`, `fn` first-class 필드, `@Trace()` 데코레이터
5. CLI에 Logger 적용 — `console.info` → Logger, Diagnostics → Logger 연결
6. Logger ALS 컨텍스트 확장 — `AsyncLocalStorage<string>` → `AsyncLocalStorage<LogContext>`, 요청/빌드 레벨 전파

---

## Phase 1: Result 스펙 삭제 + `@zipbul/result` 도입

> 에이전트: **Sonnet**
> 복잡도: 낮음

### 영향 파일

| 파일 | 변경 종류 |
|------|-----------|
| `docs/30_SPEC/common/result.spec.md` | **삭제** |
| `docs/30_SPEC/SPEC.md` | `result.spec.md` 항목 제거 |
| `docs/30_SPEC/error-handling/error-handling.spec.md` | L118 `result.spec.md` 참조 → `@zipbul/result` 패키지 참조 |
| `docs/30_SPEC/execution/execution.spec.md` | L121 `result.spec.md` 참조 → `@zipbul/result` 패키지 참조 |
| `docs/30_SPEC/common/common.spec.md` | L13 Depends-On에서 `result.spec.md` 제거, L81 참조 변경 |
| `packages/common/package.json` | `@zipbul/result` 의존성 추가 |
| `packages/common/src/index.ts` | `err`, `isErr`, `safe`, `Result`, `Err`, `ResultAsync` re-export |

### 1.1 스펙 삭제

`docs/30_SPEC/common/result.spec.md` 파일 삭제.

### 1.2 스펙 참조 정리

`SPEC.md`에서 `result.spec.md` 항목 제거.

`error-handling.spec.md` L118:

Before:
```
| Result                    | path:docs/30_SPEC/common/result.spec.md |
```

After:
```
| Result                    | url:https://www.npmjs.com/package/@zipbul/result |
```

`execution.spec.md` L121: 동일 패턴 적용.

`common.spec.md` L13 Depends-On에서 `path:docs/30_SPEC/common/result.spec.md` 제거.
`common.spec.md` L81: 참조를 `@zipbul/result` 패키지로 변경.

### 1.3 의존성 추가 및 re-export

`packages/common/package.json`에 `@zipbul/result` 추가.

`packages/common/src/index.ts`에 re-export:
```ts
export { err, isErr, safe } from '@zipbul/result';
export type { Result, Err, ResultAsync } from '@zipbul/result';
```

기존 `ZipbulError extends Error` (`packages/common/src/errors/errors.ts`) — **유지**. throw 기반 시스템 panic 전용.

---

## Phase 2: Diagnostics 체계화

> 에이전트: **Sonnet**
> 의존: Phase 1
> 복잡도: 중간

### 영향 파일

| 파일 | 변경 종류 |
|------|-----------|
| `packages/cli/src/diagnostics/types.ts` | severity 축소 |
| `packages/cli/src/diagnostics/diagnostic-reporter.ts` | severity 정렬 로직 단순화, Logger 연결 |
| `packages/cli/src/diagnostics/errors.ts` | **삭제** (`DiagnosticReportError`) |
| `packages/cli/src/diagnostics/index.ts` | export 정리 |
| `packages/cli/src/compiler/diagnostics/adapter-codes.ts` | 이동: `codes/adapter.ts` |
| `packages/cli/src/diagnostics/codes/adapter.ts` | **신규** — 기존 코드 이동 |
| `packages/cli/src/diagnostics/codes/app.ts` | **신규** — `ZIPBUL_APP_002`, `ZIPBUL_APP_018` |
| `packages/cli/src/diagnostics/codes/build.ts` | **신규** — `PARSE_FAILED`, `BUILD_FAILED`, `FILE_CYCLE_DETECTED` |
| `packages/cli/src/diagnostics/codes/index.ts` | **신규** — 전체 re-export |
| `packages/cli/src/compiler/diagnostics/adapter-codes.spec.ts` | import 경로 변경 |
| `packages/cli/src/compiler/diagnostics/index.ts` | 삭제 또는 re-export 포워딩 |
| `docs/30_SPEC/common/diagnostics.spec.md` | severity 6단계 → 2단계 |

### 2.1 severity 2단계 축소

**파일**: `packages/cli/src/diagnostics/types.ts`

Before:
```ts
export type DiagnosticSeverity = 'trace' | 'debug' | 'info' | 'warning' | 'error' | 'fatal';
```

After:
```ts
export type DiagnosticSeverity = 'error' | 'warning';
```

- `error` = 빌드 불가 → fail-fast 중단
- `warning` = 빌드 가능 → 출력하고 계속

### 2.2 진단 코드 전체 상수화

**디렉토리 구조**:
```
packages/cli/src/diagnostics/
  codes/
    adapter.ts    ← ZIPBUL_ADAPTER_001 ~ 012 (기존 이동)
    app.ts        ← ZIPBUL_APP_002, ZIPBUL_APP_018
    build.ts      ← PARSE_FAILED, BUILD_FAILED, FILE_CYCLE_DETECTED
    index.ts      ← 전체 re-export
  diagnostic-builder.ts
  diagnostic-reporter.ts
  types.ts
  index.ts
```

`packages/cli/src/diagnostics/codes/app.ts`:
```ts
/** APP-002 — createApplication 호출 수집 실패 */
export const APP_ENTRY_NOT_FOUND = 'ZIPBUL_APP_002';

/** APP-018 — 복수 createApplication 호출 감지 */
export const APP_MULTIPLE_ENTRIES = 'ZIPBUL_APP_018';
```

`packages/cli/src/diagnostics/codes/build.ts`:
```ts
/** 소스 파일 파싱 실패 */
export const BUILD_PARSE_FAILED = 'ZIPBUL_BUILD_PARSE';

/** 빌드 최종 실패 */
export const BUILD_FAILED = 'ZIPBUL_BUILD_FAILED';

/** 파일 레벨 순환 의존 감지 */
export const BUILD_FILE_CYCLE = 'ZIPBUL_BUILD_FILE_CYCLE';
```

### 2.3 `DiagnosticReportError` 삭제

`packages/cli/src/diagnostics/errors.ts` 파일 삭제.

**대체**: `DiagResult<T>` 타입 추가.

`packages/cli/src/diagnostics/types.ts`에 추가:
```ts
import type { Result } from '@zipbul/result';

/** 진단 실패를 반환하는 Result 타입. fail-fast 패턴용. */
export type DiagResult<T> = Result<T, Diagnostic>;
```

### 2.4 diagnostic-reporter 단순화

severity 정렬 로직에서 6단계 배열 제거. 2단계로 단순화.

---

## Phase 3: CLI Result 패턴 적용

> 에이전트: **Opus**
> 의존: Phase 2
> 복잡도: **높음** — adapter-spec-resolver 전면 리팩토링, build/dev command 에러 흐름 재설계

### 영향 파일

| 파일 | 변경 종류 | 복잡도 |
|------|-----------|--------|
| `packages/cli/src/compiler/analyzer/adapter-spec-resolver.ts` | `throw` → `DiagResult` 반환 | **높음** |
| `packages/cli/src/compiler/analyzer/adapter-spec-resolver.spec.ts` | 테스트 전면 수정 | **높음** |
| `packages/cli/src/compiler/analyzer/validation.ts` | `DiagnosticReportError` → `DiagResult` 반환 | 중간 |
| `packages/cli/src/compiler/analyzer/ast-parser.ts` | `throw` → `DiagResult` 반환 (2곳) | 중간 |
| `packages/cli/src/compiler/gildash-provider.ts` | `isErr→throw` → Result 그대로 전파 | 중간 |
| `packages/cli/src/compiler/gildash-provider.spec.ts` | 테스트 수정 | 중간 |
| `packages/cli/src/compiler/generator/injector-generator.ts` | `throw` → `DiagResult` 반환 (2곳) | 낮음 |
| `packages/cli/src/bin/build.command.ts` | `catch(DiagnosticReportError)` → `isErr` 분기 | 중간 |
| `packages/cli/src/bin/dev.command.ts` | `catch(DiagnosticReportError)` → `isErr` 분기 | 중간 |

### 3.1 adapter-spec-resolver — throw → DiagResult

현재: `throw new Error('[Zipbul AOT] ...')` 20+곳.

After: 모든 검증 함수가 `DiagResult<T>` 반환. 호출자가 `isErr` 확인 시 즉시 전파 (fail-fast).

```ts
// Before
if (!name || name.length === 0) {
  throw new Error(`[Zipbul AOT] defineAdapter.name must be a non-empty string in ${sourceFile}.`);
}

// After
if (!name || name.length === 0) {
  return err(buildDiagnostic({
    code: ADAPTER_INPUT_UNCOLLECTABLE,
    severity: 'error',
    summary: 'defineAdapter.name must be a non-empty string.',
    reason: 'name field is missing or empty.',
    file: sourceFile,
  }));
}
```

호출 체인:
```ts
const name = this.validateName(obj, sourceFile);
if (isErr(name)) return name;  // 즉시 전파

const pipeline = this.validatePipeline(obj, sourceFile);
if (isErr(pipeline)) return pipeline;

return { name, pipeline, ... };
```

### 3.2 validation.ts — DiagnosticReportError → DiagResult

5곳 `throw new DiagnosticReportError(...)` → `return err(diagnostic)`.

함수 시그니처 변경:
```ts
// Before
export function validateCreateApplication(fileMap: Map<string, FileAnalysis>): void

// After
export function validateCreateApplication(fileMap: Map<string, FileAnalysis>): DiagResult<CreateApplicationEntry>
```

### 3.3 gildash-provider.ts — Result 그대로 전파

현재: `isErr(result)` → `throw new Error(result.data.message)` (8곳).

After: `DiagResult` 또는 별도 에러 타입으로 Result 그대로 반환.

```ts
// Before
if (isErr(result)) {
  throw new Error(result.data.message, { cause: result.data.cause });
}

// After
if (isErr(result)) return result;
```

### 3.4 build.command.ts / dev.command.ts — isErr 분기

```ts
// Before
try {
  // ...
} catch (error) {
  if (error instanceof DiagnosticReportError) {
    reportDiagnostics({ diagnostics: [error.diagnostic] });
    throw error;
  }
}

// After
const result = await compile(...);
if (isErr(result)) {
  reportDiagnostic(result.data, logger);
  process.exit(1);
}
```

### throw 유지 대상

| 위치 | 이유 |
|------|------|
| `manifest-generator.ts` — "FATAL: AOT Registry is immutable" | 내부 불변식 위반 (프레임워크 버그) |
| `build.command.ts` — "Manifest not deterministic" | 내부 불변식 위반 |

---

## Phase 4: Logger 개선

> 에이전트: **Sonnet**
> 의존: 없음 (Phase 1~3과 병렬 가능)
> 복잡도: 중간

### 영향 파일

| 파일 | 변경 종류 |
|------|-----------|
| `packages/logger/src/logger.ts` | Transport 배열화, `child()` 메서드, `fn` 해소 로직 |
| `packages/logger/src/interfaces.ts` | `LoggerOptions.transports` 추가, `BaseLogMessage.fn` 추가 |
| `packages/logger/src/transports/test.ts` | **신규** — TestTransport |
| `packages/logger/src/transports/console.ts` | 변경 없음 |
| `packages/logger/src/trace.ts` | **신규** — `@Trace()` 데코레이터 |
| `packages/logger/index.ts` | TestTransport, Trace export 추가 |

### 4.1 Transport 다중화

**파일**: `packages/logger/src/logger.ts`

Before:
```ts
private static transport: Transport = new ConsoleTransport(Logger.globalOptions);
```

After:
```ts
private static transports: Transport[] = [new ConsoleTransport(Logger.globalOptions)];
```

`configure()` 확장:
```ts
static configure(options: LoggerOptions) {
  this.globalOptions = { ...this.globalOptions, ...options };
  if (options.transports) {
    this.transports = options.transports;
  } else {
    this.transports = [new ConsoleTransport(this.globalOptions)];
  }
}
```

fan-out:
```ts
private emit(message: LogMessage): void {
  for (const t of Logger.transports) {
    t.log(message);
  }
}
```

기존 `Logger.transport.log(logMessage)` 호출 → `this.emit(logMessage)` 호출로 변경.

### 4.3-a `fn` first-class 필드

**파일**: `packages/logger/src/interfaces.ts`

`BaseLogMessage`에 `fn` 필드 추가:
```ts
interface BaseLogMessage {
  level: LogLevel;
  msg: string;
  time: number;
  context?: string;    // 클래스/모듈명 (Logger constructor)
  fn?: string;         // 함수명 (@Trace > child — 항상 로컬, ALS 무관)
  reqId?: string;
  workerId?: number;
  err?: Error | Loggable;
}
```

### 4.3-b `Logger.child()` 메서드

**파일**: `packages/logger/src/logger.ts`

```ts
class Logger {
  private readonly metadata: LogMetadataRecord;

  constructor(context?: string | LogContextTarget, metadata?: LogMetadataRecord) {
    // ... 기존 context 로직 ...
    this.metadata = metadata ?? {};
  }

  child(metadata: LogMetadataRecord): Logger {
    return new Logger(this.context, { ...this.metadata, ...metadata });
  }
}
```

`log()` 메서드에서 인스턴스 메타데이터 합성:
```ts
private log(level: LogLevel, msg: string, ...args) {
  // ... logMessage 생성 ...

  // 인스턴스 메타데이터 (child)
  if (this.metadata.fn) {
    logMessage.fn = this.metadata.fn as string;
  }
  Object.assign(logMessage, this.metadata);

  // ALS 컨텍스트 (reqId 등 — fn 제외)
  const alsContext = RequestContext.getContext();
  if (alsContext) {
    const { fn: _ignored, ...rest } = alsContext;
    Object.assign(logMessage, rest);
  }

  // ... per-call args ...
}
```

**사용 패턴 (standalone 함수)**:
```ts
const logger = new Logger('hash');

export function hashPassword(password: string) {
  const log = logger.child({ fn: 'hashPassword' });
  log.info('hashing');
  // → { context: 'hash', fn: 'hashPassword', msg: 'hashing', reqId: '...' }
}
```

### 4.3-c `@Trace()` 데코레이터

**파일**: `packages/logger/src/trace.ts` (**신규**)

클래스 메서드 전용. 메서드 실행 동안 해당 인스턴스의 `logger.fn`을 설정.

```ts
export function Trace() {
  return function <T extends (...args: any[]) => any>(
    target: T,
    context: ClassMethodDecoratorContext,
  ) {
    const methodName = String(context.name);

    return function (this: any, ...args: Parameters<T>) {
      const className = this?.constructor?.name ?? 'Unknown';
      const qualifiedName = `${className}.${methodName}`;

      // logger 인스턴스가 있으면 fn 설정
      const logger: Logger | undefined = this.logger;
      const prevFn = logger?.['_fn'];

      if (logger) logger['_fn'] = qualifiedName;
      try {
        return target.apply(this, args);
      } finally {
        if (logger) logger['_fn'] = prevFn;
      }
    } as T;
  };
}
```

**사용 패턴 (클래스 메서드)**:
```ts
class OrderService {
  private logger = new Logger(this);

  @Trace()
  async processOrder(orderId: string) {
    this.logger.info('started');
    // → { context: 'OrderService', fn: 'OrderService.processOrder', msg: 'started' }
  }
}
```

**`fn` 해소 우선순위**: `@Trace()` > `child({ fn })` > 없음

| 상황 | @Trace() | child({ fn }) | 결과 fn |
|------|----------|---------------|---------|
| 클래스 + @Trace() | `'OrderService.process'` | 없음 | `'OrderService.process'` |
| 클래스 + @Trace() + child | `'OrderService.process'` | `'whatever'` | `'OrderService.process'` |
| standalone + child | 없음 | `'hashPassword'` | `'hashPassword'` |
| 아무것도 없음 | 없음 | 없음 | `undefined` |

### 4.2 TestTransport

**파일**: `packages/logger/src/transports/test.ts`

```ts
export class TestTransport implements Transport {
  readonly messages: LogMessage[] = [];

  log(message: LogMessage): void {
    this.messages.push(message);
  }

  clear(): void {
    this.messages.length = 0;
  }

  findByLevel(level: LogLevel): LogMessage[] {
    return this.messages.filter(m => m.level === level);
  }
}
```

### 4.4 LogLevel 유지 (6단계)

Logger의 LogLevel은 **변경 없음**:
```ts
type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
```

Diagnostic severity (2단계)와 Logger LogLevel (6단계)은 별개 시스템.

---

## Phase 5: CLI Logger 적용 + Diagnostics 연결

> 에이전트: **Opus**
> 의존: Phase 2, 3, 4
> 복잡도: 중간

### 영향 파일

| 파일 | 변경 종류 |
|------|-----------|
| `packages/cli/src/bin/build.command.ts` | `console.info` → `logger.info` (12곳) |
| `packages/cli/src/bin/dev.command.ts` | `console.info` → `logger.info` |
| `packages/cli/src/diagnostics/diagnostic-reporter.ts` | Logger를 통한 출력 |
| `packages/cli/package.json` | `@zipbul/logger` 의존성 추가 |

### 5.1 build.command.ts Logger 적용

```ts
import { Logger } from '@zipbul/logger';

const logger = new Logger('Build');

// Before: console.info('🚀 Starting Zipbul Production Build...');
// After:
logger.info('Starting Zipbul Production Build...');
```

### 5.2 Diagnostics → Logger 연결

`diagnostic-reporter.ts` 변경:

```ts
import { Logger } from '@zipbul/logger';

export function reportDiagnostic(diagnostic: Diagnostic, logger: Logger): void {
  if (diagnostic.severity === 'error') {
    logger.error(diagnostic.summary, { diagnostic });
  } else {
    logger.warn(diagnostic.summary, { diagnostic });
  }
}
```

매핑:

| Diagnostic severity | Logger level |
|---------------------|-------------|
| `error` | `logger.error()` |
| `warning` | `logger.warn()` |

---

## Phase 6: Logger ALS 컨텍스트 확장

> 에이전트: **Sonnet**
> 의존: Phase 4
> 복잡도: 중간

### 영향 파일

| 파일 | 변경 종류 |
|------|-----------|
| `packages/logger/src/async-storage.ts` | `AsyncLocalStorage<string>` → `AsyncLocalStorage<LogContext>`, 중첩 merge |
| `packages/logger/src/interfaces.ts` | `LogContext` 타입 추가 |
| `packages/logger/src/logger.ts` | ALS 컨텍스트 읽기 로직 변경 |
| `packages/logger/index.ts` | `LogContext` export 추가 |

### 6.1 ALS 저장소 확장

**파일**: `packages/logger/src/async-storage.ts`

Before:
```ts
class RequestContext {
  private static storage = new AsyncLocalStorage<string>();

  static run<R>(reqId: string, callback: () => R): R {
    return this.storage.run(reqId, callback);
  }

  static getRequestId(): string | undefined {
    return this.storage.getStore();
  }
}
```

After:
```ts
import type { LogContext } from './interfaces';

class RequestContext {
  private static storage = new AsyncLocalStorage<LogContext>();

  static run<R>(context: LogContext, callback: () => R): R {
    const parent = this.storage.getStore();
    const merged = parent ? { ...parent, ...context } : context;
    return this.storage.run(merged, callback);
  }

  static getContext(): LogContext | undefined {
    return this.storage.getStore();
  }

  /** backward compat */
  static getRequestId(): string | undefined {
    return this.storage.getStore()?.reqId as string | undefined;
  }
}
```

중첩 `run()` 호출 시 부모 컨텍스트와 shallow merge. 안쪽 scope이 바깥을 상속.

### 6.2 `LogContext` 타입

**파일**: `packages/logger/src/interfaces.ts`

```ts
export interface LogContext {
  [key: string]: LogMetadataValue;
}
```

generic KV. 주요 컨벤션 키:

| 키 | 용도 | 설정 위치 |
|----|------|----------|
| `reqId` | 요청 ID | HTTP 미들웨어 |
| `buildId` | 빌드 ID | CLI build command |
| `userId` | 인증 사용자 | 인증 미들웨어 |

**`fn`은 ALS에 저장하지 않음** — `fn`은 항상 로컬 (`@Trace()` or `child()`).

### 6.3 Logger의 ALS 읽기

`Logger.log()` 메서드에서 ALS 컨텍스트를 LogMessage에 합성:

```ts
// ALS 컨텍스트 (reqId, buildId 등)
const alsContext = RequestContext.getContext();
if (alsContext) {
  Object.assign(logMessage, alsContext);
}
```

합성 우선순위 (낮음 → 높음):

```
ALS context (reqId, buildId 등) < instance metadata (child) < @Trace() fn < per-call args
```

### 6.4 사용 시나리오

**런타임 (HTTP 서버)**:
```ts
// 미들웨어
RequestContext.run({ reqId: crypto.randomUUID() }, async () => {
  await handler(req, res);
  // 이 안의 모든 로그에 reqId 자동 첨부
});
```

**CLI (빌드)**:
```ts
RequestContext.run({ buildId: id }, async () => {
  await compile(config);
  // 이 안의 모든 로그에 buildId 자동 첨부 — 클래스/함수 무관
});
```

---

## 실행 순서 및 에이전트 할당 요약

```
Phase 1 ─── Sonnet ─── Result 스펙 삭제 + @zipbul/result 도입
  │
  └─── Phase 2 ─── Sonnet ─── Diagnostics 체계화
         │
         └─── Phase 3 ─── Opus ─── CLI Result 패턴 적용 (adapter-spec-resolver 전면 리팩토링)

Phase 4 ─── Sonnet ─── Logger 개선 (Phase 1~3과 병렬)
  │
  └─── Phase 6 ─── Sonnet ─── ALS 컨텍스트 확장

Phase 3 + Phase 4 완료 후:
  └─── Phase 5 ─── Opus ─── CLI Logger 적용 + Diagnostics 연결
```

| Phase | 에이전트 | 파일 수 | 복잡도 | 배정 이유 |
|-------|---------|---------|--------|-----------|
| 1 | Sonnet | 7 | 낮음 | 스펙 삭제 + 의존성 추가, 기계적 변경 |
| 2 | Sonnet | 12 | 중간 | 타입 변경 + 파일 이동/생성, 패턴화된 작업 |
| 3 | Opus | 9 | **높음** | adapter-spec-resolver 전면 리팩토링, 에러 흐름 재설계, 대규모 테스트 수정 |
| 4 | Sonnet | 7 | 중간 | Logger 구조 변경, child/Trace/TestTransport 추가 |
| 5 | Opus | 4 | 중간 | build/dev command 통합 적용, Diagnostics-Logger 연결 |
| 6 | Sonnet | 4 | 중간 | ALS 확장, RequestContext 리팩토링 |

---

## 커밋 단위

| 순서 | 범위 | 메시지 |
|------|------|--------|
| 1 | Phase 1 | `refactor(common): replace result spec with @zipbul/result package` |
| 2 | Phase 2 | `refactor(cli): systematize diagnostic codes and simplify severity` |
| 3 | Phase 3 | `refactor(cli): apply Result pattern with fail-fast across build pipeline` |
| 4 | Phase 4 | `feat(logger): add child, Trace decorator, multiple transports, TestTransport` |
| 5 | Phase 6 | `feat(logger): expand ALS context from reqId string to LogContext object` |
| 6 | Phase 5 | `refactor(cli): replace console calls with Logger and connect diagnostics` |

---

## 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| adapter-spec-resolver 반환 타입 변경 파급 | 호출자 전체 수정 필요 | Phase 3에서 Opus가 전체 호출 체인 추적 |
| `DiagnosticReportError` 삭제 시 dev.command.ts 에러 흐름 변경 | dev 모드 동작 변경 | Phase 3에서 dev.command.ts도 함께 수정 |
| severity 6→2단계 축소 시 diagnostics.spec.md 동기화 | 스펙-코드 불일치 | Phase 2에서 스펙 동시 업데이트 |
| Logger static 상태 테스트 오염 | 테스트 간 간섭 | Phase 4에서 TestTransport + 테스트 setUp/tearDown 패턴 확립 |
| `@Trace()` 데코레이터가 `this.logger` 존재 가정 | logger 없는 클래스에서 사용 시 무시 | `logger` 존재 여부 방어 코드, 문서화 |
| ALS `run()` 중첩 시 shallow merge로 부모 키 덮어씀 | 의도치 않은 값 소실 | 동일 키 중첩 금지 컨벤션, 문서화 |
