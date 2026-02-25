# CLI Result + Diagnostics + Logger 통합 리팩토링 계획

> Status: **Confirmed — 구현 대기**
> Created: 2025-02-25

---

## 목표

0. CLI 바이너리 리네임 — `zp` → `zb`
1. `@zipbul/result` 외부 라이브러리 도입
2. CLI Diagnostics 체계화 — severity 2단계 축소, 진단 코드 전체 상수화(`ZB_` prefix), `DiagnosticReportError` 삭제, `BuildDiagnosticParams.file` 제거
3. CLI에 Result 패턴 적용 — fail-fast, `Result<T, Diagnostic>` 직접 사용
4. Logger 전면 개선 + ALS 확장 — Transport 다중화, TestTransport, `child()`, `fn` first-class 필드, `@Trace()` (ALS 기반), `AsyncLocalStorage<string>` → `AsyncLocalStorage<LogContext>`, 요청(프로토콜 무관)/fn 레벨 전파
5. CLI에 Logger 적용 — `console.info` → Logger, Diagnostics → Logger 연결

---

## Phase 0: CLI 바이너리 리네임 (`zp` → `zb`)

> 에이전트: **Sonnet**
> 의존: 없음
> 복잡도: 낮음

### 변경 대상

- `packages/cli/src/bin/zp.ts` → `packages/cli/src/bin/zb.ts` (파일 리네임)
- `packages/cli/package.json` — `bin.zp` → `bin.zb`, build 스크립트 경로 변경
- `packages/cli/src/bin/zb.ts` 내 Usage 문자열: `Usage: zp <command>` → `Usage: zb <command>`

### 커밋

`refactor(cli): rename binary from zp to zb`

---

## Phase 1: `@zipbul/result` 도입

> 에이전트: **Sonnet**
> 복잡도: 낮음

### 영향 파일

| 파일 | 변경 종류 |
|------|-----------|
| `packages/common/package.json` | `@zipbul/result` 의존성 추가 |
| `packages/common/src/index.ts` | `err`, `isErr`, `safe`, `Result`, `Err`, `ResultAsync` re-export |

### 1.1 의존성 추가 및 re-export

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
| `packages/cli/src/diagnostics/types.ts` | severity 축소, `BuildDiagnosticParams.file` 제거 |
| `packages/cli/src/diagnostics/diagnostic-reporter.ts` | severity 정렬 로직 단순화 |
| `packages/cli/src/compiler/analyzer/validation.ts` | `severity: 'fatal'` → `'error'` 치환 (5곳) |
| `packages/cli/src/diagnostics/errors.ts` | **삭제** (`DiagnosticReportError`) |
| `packages/cli/src/diagnostics/index.ts` | export 정리 |
| `packages/cli/src/compiler/diagnostics/adapter-codes.ts` | 이동: `codes/adapter.ts` |
| `packages/cli/src/diagnostics/codes/adapter.ts` | **신규** — 기존 코드 이동 |
| `packages/cli/src/diagnostics/codes/app.ts` | **신규** — `ZB_APP_002`, `ZB_APP_018` |
| `packages/cli/src/diagnostics/codes/build.ts` | **신규** — `ZB_BUILD_001`, `ZB_BUILD_002`, `ZB_BUILD_003` |
| `packages/cli/src/diagnostics/codes/cli.ts` | **신규** — `ZB_CLI_001` (INVALID_COMMAND) |
| `packages/cli/src/diagnostics/codes/dev.ts` | **신규** — `ZB_DEV_001`, `ZB_DEV_002` |
| `packages/cli/src/diagnostics/codes/index.ts` | **신규** — 전체 re-export |
| `packages/cli/src/compiler/diagnostics/adapter-codes.spec.ts` | import 경로 변경 |
| `packages/cli/src/compiler/diagnostics/index.ts` | 삭제 또는 re-export 포워딩 |

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
    adapter.ts    ← ZB_ADAPTER_001 ~ 012 (기존 이동)
    app.ts        ← ZB_APP_002, ZB_APP_018
    build.ts      ← ZB_BUILD_001 ~ 003
    cli.ts        ← ZB_CLI_001
    dev.ts        ← ZB_DEV_001 ~ 002
    index.ts      ← 전체 re-export
  diagnostic-builder.ts
  diagnostic-reporter.ts
  types.ts
  index.ts
```

**진단 코드 네이밍 규칙**:
- 상수명: 의미 기술 (SCREAMING_SNAKE_CASE) — 사람 친화적
- 코드값: `ZB_{DOMAIN}_{NNN}` (3자리 zero-padded) — 도구 친화적
- 도메인: `ADAPTER`, `APP`, `BUILD`, `CLI`, `DEV`

`packages/cli/src/diagnostics/codes/app.ts`:
```ts
/** APP-002 — createApplication 호출 수집 실패 */
export const APP_ENTRY_NOT_FOUND = 'ZB_APP_002';

/** APP-018 — 복수 createApplication 호출 감지 */
export const APP_MULTIPLE_ENTRIES = 'ZB_APP_018';
```

`packages/cli/src/diagnostics/codes/build.ts`:
```ts
/** BUILD-001 — 소스 파일 파싱 실패 */
export const BUILD_PARSE_FAILED = 'ZB_BUILD_001';

/** BUILD-002 — 빌드 최종 실패 */
export const BUILD_FAILED = 'ZB_BUILD_002';

/** BUILD-003 — 파일 레벨 순환 의존 감지 */
export const BUILD_FILE_CYCLE = 'ZB_BUILD_003';
```

`packages/cli/src/diagnostics/codes/cli.ts`:
```ts
/** CLI-001 — 알 수 없는 커맨드 */
export const CLI_INVALID_COMMAND = 'ZB_CLI_001';
```

`packages/cli/src/diagnostics/codes/dev.ts`:
```ts
/** DEV-001 — dev 모드 실패 */
export const DEV_FAILED = 'ZB_DEV_001';

/** DEV-002 — gildash 파싱 실패 */
export const DEV_GILDASH_PARSE = 'ZB_DEV_002';
```

### 2.3 `DiagnosticReportError` 삭제

`packages/cli/src/diagnostics/errors.ts` 파일 삭제.

**대체**: `Result<T, Diagnostic>` 직접 사용 (별도 alias 없음).

진단 실패를 반환하는 함수 시그니처:
```ts
import type { Result } from '@zipbul/result';
import type { Diagnostic } from './types';

// 예시: Result<T, Diagnostic> 직접 사용
function validate(...): Result<AdapterSpecResolution, Diagnostic> { ... }
```

별도 `DiagResult` alias를 두지 않는다. `Result<T, E>`의 에러 타입이 시그니처에 명시적으로 보여야 가독성과 일관성이 높다.

### 2.4 diagnostic-reporter 단순화

severity 정렬 로직에서 6단계 배열 제거. 2단계로 단순화.

### 2.5 `BuildDiagnosticParams.file` 필드 제거

**파일**: `packages/cli/src/diagnostics/types.ts`

`BuildDiagnosticParams`에서 `file` 필드 제거. 파일 정보가 필요한 경우 `summary` 또는 `reason` 문자열에 포함.

---

## Phase 3: CLI Result 패턴 적용

> 에이전트: **Opus**
> 의존: Phase 2
> 복잡도: **높음** — adapter-spec-resolver 전면 리팩토링, build/dev command 에러 흐름 재설계

### 영향 파일

| 파일 | 변경 종류 | 복잡도 |
|------|-----------|--------|
| `packages/cli/src/compiler/analyzer/adapter-spec-resolver.ts` | `throw` → `Result<T, Diagnostic>` 반환 | **높음** |
| `packages/cli/src/compiler/analyzer/adapter-spec-resolver.spec.ts` | 테스트 전면 수정 | **높음** |
| `packages/cli/src/compiler/analyzer/validation.ts` | `DiagnosticReportError` → `Result<T, Diagnostic>` 반환 | 중간 |
| `packages/cli/src/compiler/analyzer/ast-parser.ts` | `throw` → `Result<T, Diagnostic>` 반환 (2곳) | 중간 |
| `packages/cli/src/compiler/gildash-provider.ts` | `isErr→throw` → gildash error→Diagnostic 변환 + `err()` 반환 | 중간 |
| `packages/cli/src/compiler/gildash-provider.spec.ts` | 테스트 수정 | 중간 |
| `packages/cli/src/compiler/generator/injector-generator.ts` | `throw` → `Result<T, Diagnostic>` 반환 (2곳) | 낮음 |
| `packages/cli/src/bin/build.command.ts` | `catch(DiagnosticReportError)` → `isErr` 분기 | 중간 |
| `packages/cli/src/bin/dev.command.ts` | `catch(DiagnosticReportError)` → `isErr` 분기 | 중간 |
| `packages/cli/src/bin/mcp.command.ts` | GildashProvider 반환 타입 변경 대응 | 중간 |
| `packages/cli/src/diagnostics/diagnostic-reporter.ts` | `reportDiagnostics`(복수) → `reportDiagnostic`(단수) 전환 | 낮음 |

### 3.1 adapter-spec-resolver — throw → Result<T, Diagnostic>

현재: `throw new Error('[Zipbul AOT] ...')` 25+곳.

After: 모든 검증 함수가 `Result<T, Diagnostic>` 반환. 호출자가 `isErr` 확인 시 즉시 전파 (fail-fast).

```ts
// Before
if (!name || name.length === 0) {
  throw new Error(`[Zipbul AOT] defineAdapter.name must be a non-empty string in ${sourceFile}.`);
}

// After
if (!name || name.length === 0) {
  return err(buildDiagnostic({
    code: ADAPTER_INPUT_UNCOLLECTABLE,  // 'ZB_ADAPTER_002'
    severity: 'error',
    summary: 'defineAdapter.name must be a non-empty string.',
    reason: 'name field is missing or empty.',
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

### 3.2 validation.ts — DiagnosticReportError → Result<T, Diagnostic>

5곳 `throw new DiagnosticReportError(...)` → `return err(diagnostic)`.

`ApplicationEntry` 타입 정의 추가:
```ts
export interface ApplicationEntry {
  filePath: string;
  entryRef: string;       // __zipbul_ref 값
}
```

함수 시그니처 변경:
```ts
// Before
export function validateCreateApplication(fileMap: Map<string, FileAnalysis>): void

// After
export function validateCreateApplication(fileMap: Map<string, FileAnalysis>): Result<ApplicationEntry, Diagnostic>
```

### 3.3 gildash-provider.ts — 에러 변환 레이어 유지 + throw → err() 반환

현재: `isErr(result)` → `throw new Error(result.data.message)` (7곳).

After: gildash 에러 → `Diagnostic`으로 변환하되, throw 대신 `err(diagnostic)` 반환.
gildash-provider는 에러 변환 레이어 역할을 계속 담당한다.

```ts
// Before
if (isErr(result)) {
  throw new Error(result.data.message, { cause: result.data.cause });
}

// After
if (isErr(result)) {
  return err(buildDiagnostic({
    code: DEV_GILDASH_PARSE,
    severity: 'error',
    summary: result.data.message,
    reason: result.data.message,
  }));
}
```

호출자는 `Result<T, Diagnostic>` 통일 타입으로 처리. gildash 내부 에러 타입이 외부로 노출되지 않는다.

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
  reportDiagnostic(result.data);
  process.exit(1);
}
```

### throw 유지 대상

| 위치 | 이유 |
|------|------|
| `manifest-generator.ts` — "FATAL: AOT Registry is immutable" | 내부 불변식 위반 (프레임워크 버그) |
| `build.command.ts` — "Manifest not deterministic" | 내부 불변식 위반 |

---

## Phase 4: Logger 전면 개선 + ALS 확장

> 에이전트: **Sonnet**
> 의존: 없음 (Phase 1~3과 병렬 가능)
> 복잡도: 높음

### 영향 파일

| 파일 | 변경 종류 |
|------|----------|
| `packages/logger/src/logger.ts` | Transport 배열화, `child()` 메서드, `fn` 해소 로직, ALS 컨텍스트 읽기 |
| `packages/logger/src/interfaces.ts` | `LoggerOptions.transports` 추가, `BaseLogMessage.fn` 추가, `LogContext` 타입 추가 |
| `packages/logger/src/async-storage.ts` | `AsyncLocalStorage<string>` → `AsyncLocalStorage<LogContext>`, 중첩 merge |
| `packages/logger/src/transports/test.ts` | **신규** — TestTransport |
| `packages/logger/src/transports/console.ts` | 변경 없음 |
| `packages/logger/src/trace.ts` | **신규** — `@Trace()` 데코레이터 |
| `packages/logger/index.ts` | TestTransport, Trace, `LogContext` export 추가 |

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
  fn?: string;         // 함수명 (@Trace=ALS, child=instance, per-call)
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

`log()` 메서드에서 합성 순서 (우선순위 낮음 → 높음):
```ts
private log(level: LogLevel, msg: string, ...args) {
  // ... logMessage 생성 ...

  // 1. ALS 컨텍스트 (reqId, fn 등)
  const alsContext = RequestContext.getContext();
  if (alsContext) {
    Object.assign(logMessage, alsContext);
  }

  // 2. 인스턴스 메타데이터 (child) — ALS보다 우선
  Object.assign(logMessage, this.metadata);

  // 3. per-call args — 최종 우선
  for (const arg of args) {
    if (arg instanceof Error) {
      logMessage.err = arg;
    } else if (this.isLoggable(arg)) {
      Object.assign(logMessage, arg.toLog());
    } else if (typeof arg === 'object' && arg !== null) {
      Object.assign(logMessage, arg);
    }
  }

  this.emit(logMessage);
}
```

합성 우선순위: **ALS < child metadata < per-call args**. 단방향 덕어쓰기.

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

클래스 메서드 전용. ALS 기반으로 fn을 설정하여 async 동시성 안전.

```ts
import { RequestContext } from './async-storage';

export function Trace() {
  return function <T extends (...args: any[]) => any>(
    target: T,
    context: ClassMethodDecoratorContext,
  ) {
    const methodName = String(context.name);

    return function (this: any, ...args: Parameters<T>) {
      const className = this?.constructor?.name ?? 'Unknown';
      const qualifiedName = `${className}.${methodName}`;

      return RequestContext.run({ fn: qualifiedName }, () => {
        return target.apply(this, args);
      });
    } as T;
  };
}
```

**설계 근거**: ALS는 async context 격리가 본업이므로 fn을 넣는 것이 자연스럽다. mutable instance state 조작 대신 ALS scope으로 격리하면 concurrent async 호출에서도 fn이 뒤섞이지 않는다. AOT 환경에서는 빌드 타임에 메서드명을 정적으로 결정할 수 있어 runtime reflection 의존을 제거할 수 있다.

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

**`fn` 해소 우선순위**: `per-call args` > `child({ fn })` > `@Trace()` (ALS) > 없음

합성 순서(ALS < child < per-call) 그대로 적용. `@Trace()`는 ALS에 fn을 넣고, `child()`는 instance metadata로 ALS를 덮어쓰며, per-call args가 최종 우선.

| 상황 | @Trace() | child({ fn }) | 결과 fn |
|------|----------|---------------|---------|
| 클래스 + @Trace() | ALS `'OrderService.process'` | 없음 | `'OrderService.process'` |
| 클래스 + @Trace() + child | ALS `'OrderService.process'` | `'whatever'` | `'whatever'` (child가 ALS보다 우선) |
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
}
```

### 4.4 LogLevel 유지 (6단계)

Logger의 LogLevel은 **변경 없음**:
```ts
type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
```

Diagnostic severity (2단계)와 Logger LogLevel (6단계)은 별개 시스템.

### 4.5 ALS 저장소 확장

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

### 4.6 `LogContext` 타입

**파일**: `packages/logger/src/interfaces.ts`

```ts
export interface LogContext {
  [key: string]: LogMetadataValue;
}
```

generic KV. 주요 컨벤션 키:

| 키 | 용도 | 설정 위치 |
|----|------|----------|
| `reqId` | 요청 ID | 프로토콜 어댑터 / core |
| `userId` | 인증 사용자 | 인증 계층 |
| `fn` | 함수명 | `@Trace()` (ALS), `child()` |

`@Trace()` 데코레이터는 ALS에 fn을 설정한다. `child({ fn })`은 instance metadata로 ALS의 fn을 덮어쓸 수 있다.

### 4.7 Logger의 ALS 읽기

`Logger.log()` 메서드에서 ALS 컨텍스트를 LogMessage에 합성:

```ts
// ALS 컨텍스트 (reqId, fn 등)
const alsContext = RequestContext.getContext();
if (alsContext) {
  Object.assign(logMessage, alsContext);
}
```

합성 우선순위 (낮음 → 높음):

```
ALS context (reqId, fn 등) < instance metadata (child) < per-call args
```

### 4.8 사용 시나리오

**요청 시작부 (프로토콜 무관)**:
```ts
// 프로토콜 어댑터 또는 core에서 요청 수신 시
RequestContext.run({ reqId: crypto.randomUUID() }, async () => {
  await handler(req, res);
  // 이 안의 모든 로그에 reqId 자동 첨부
});
```

**독립 프로세스 (스케줄러, 워커, 배치)**:
```ts
// 프로토콜 요청과 무관한 독립 실행 단위
RequestContext.run({ reqId: crypto.randomUUID() }, async () => {
  await scheduledTask();
  // 이 안의 모든 로그에 reqId 자동 첨부
});
```

`reqId`는 프로토콜에 종속되지 않는다. HTTP, WebSocket, gRPC, CLI 커맨드, 배치 작업 — 모든 실행 단위의 시작부에서 생성하여 ALS로 전파한다.

---

## Phase 5: CLI Logger 적용 + Diagnostics 연결

> 에이전트: **Opus**
> 의존: Phase 2, 3, 4
> 복잡도: 중간

### CLI Logger 구조

```
zb.ts (진입점)
  │
  ├─ Logger.configure({ level: verbose ? 'debug' : 'info' })
  │
  ├─ new Logger('Build')      ← build.command.ts
  ├─ new Logger('Dev')        ← dev.command.ts
  ├─ new Logger('Diagnostic') ← diagnostic-reporter.ts
  ├─ new Logger('Analyzer')   ← adapter-spec-resolver.ts (필요 시)
  └─ new Logger('Gildash')    ← gildash-provider.ts (필요 시)
```

각 모듈이 자체 context로 Logger 인스턴스를 생성. static transport 공유로 설정 충돌 없음.
CLI 내부 코드에서도 `fn`은 **필수** — trace/debug 레벨에서 함수 위치 추적이 필요. 클래스 메서드는 `@Trace()`로 자동 주입, 독립 함수는 `child({ fn })`으로 명시적 주입.

### 영향 파일

| 파일 | 변경 종류 |
|------|-----------|
| `packages/cli/src/bin/zb.ts` | `Logger.configure()` 호출 추가 |
| `packages/cli/src/bin/build.command.ts` | `console.info` → `logger.info` (12곳) |
| `packages/cli/src/bin/dev.command.ts` | `console.info` → `logger.info` |
| `packages/cli/src/diagnostics/diagnostic-reporter.ts` | 자체 Logger 인스턴스로 출력 |
| `packages/cli/package.json` | `@zipbul/logger` 의존성 추가 |

### 5.1 진입점 Logger 초기화

**파일**: `packages/cli/src/bin/zb.ts`

```ts
import { Logger } from '@zipbul/logger';

Logger.configure({ level: verbose ? 'debug' : 'info' });
```

### 5.2 build.command.ts / dev.command.ts Logger 적용

```ts
import { Logger } from '@zipbul/logger';

const logger = new Logger('Build');

// Before: console.info('🚀 Starting Zipbul Production Build...');
// After:
logger.info('Starting Zipbul Production Build...');
```

### 5.3 Diagnostics → Logger 연결

`diagnostic-reporter.ts` 변경:

```ts
import { Logger } from '@zipbul/logger';

const logger = new Logger('Diagnostic');

export function reportDiagnostic(diagnostic: Diagnostic): void {
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

## 실행 순서 및 에이전트 할당 요약

```
Phase 0 ─── Sonnet ─── CLI 바이너리 리네임 (zp → zb)
  │
  └─── Phase 1 ─── Sonnet ─── @zipbul/result 도입
         │
         └─── Phase 2 ─── Sonnet ─── Diagnostics 체계화 (ZB_ prefix)
                │
                └─── Phase 3 ─── Opus ─── CLI Result 패턴 적용 (adapter-spec-resolver 전면 리팩토링)

Phase 4 ─── Sonnet ─── Logger 전면 개선 + ALS 확장 (Phase 0~3과 병렬)

Phase 3 + Phase 4 완료 후:
  └─── Phase 5 ─── Opus ─── CLI Logger 적용 + Diagnostics 연결
```

| Phase | 에이전트 | 복잡도 | 배정 이유 |
|-------|---------|--------|-----------|
| 0 | Sonnet | 낮음 | 파일 리네임 + 문자열 치환, 기계적 변경 |
| 1 | Sonnet | 낮음 | 의존성 추가, 기계적 변경 |
| 2 | Sonnet | 중간 | 타입 변경 + 파일 이동/생성, 패턴화된 작업 |
| 3 | Opus | **높음** | adapter-spec-resolver 전면 리팩토링, 에러 흐름 재설계, 대규모 테스트 수정 |
| 4 | Sonnet | **높음** | Logger 전면 개선 + ALS 확장, child/Trace/TestTransport/LogContext 추가 |
| 5 | Opus | 중간 | build/dev command 통합 적용, Diagnostics-Logger 연결 |

---

## 커밋 단위

| 순서 | 범위 | 메시지 |
|------|------|--------|
| 0 | Phase 0 | `refactor(cli): rename binary from zp to zb` |
| 1 | Phase 1 | `refactor(common): introduce @zipbul/result package` |
| 2 | Phase 2 | `refactor(cli): systematize diagnostic codes with ZB_ prefix and simplify severity` |
| 3 | Phase 3 | `refactor(cli): apply Result pattern with fail-fast across build pipeline` |
| 4 | Phase 4 | `feat(logger): add child, Trace, multiple transports, expand ALS to LogContext` |
| 5 | Phase 5 | `refactor(cli): replace console calls with Logger and connect diagnostics` |

---

## 리스크

| 리스크 | 영향 | 대응 |
|--------|------|------|
| adapter-spec-resolver 반환 타입 변경 파급 | 호출자 전체 수정 필요 | Phase 3에서 Opus가 전체 호출 체인 추적 |
| `DiagnosticReportError` 삭제 시 dev.command.ts 에러 흐름 변경 | dev 모드 동작 변경 | Phase 3에서 dev.command.ts도 함께 수정 |
| severity 6→2단계 축소 시 코드 동기화 | `'fatal'` 사용처 컴파일 에러 | Phase 2에서 severity 변경 시 모든 사용처 일괄 마이그레이션 |
| Logger static 상태 테스트 오염 | 테스트 간 간섭 | Phase 4에서 TestTransport + 테스트 setUp/tearDown 패턴 확립 |
| `@Trace()` ALS 기반 — `RequestContext.run` 호출 오버헤드 | 고빈도 메서드에서 미미한 성능 영향 | hot path에서는 `child()` 사용 권장, `@Trace()`는 서비스 레벨 메서드 전용 |
| ALS `run()` 중첩 시 shallow merge로 부모 키 덮어씀 | 의도치 않은 값 소실 | 동일 키 중첩 금지 컨벤션, 문서화 |
