# Cluster Manager 재설계 계획

## 현황 요약

현재 `@zipbul/core/src/cluster/` 구현은 프로토타입 수준이며 프로덕션에 사용할 수 없다.
이 문서는 Bun Worker API의 정확한 동작 사양에 기반하여 프로덕션급 클러스터 매니저를 설계한다.

---

## Phase 0: Bun Worker API 정확한 사양 정리

계획의 모든 결정은 이 사양에 기반한다. 추측이 아니라 Bun 소스 코드와 공식 문서에서 검증된 사실만 기록한다.

### `smol: true`

- JSC(JavaScriptCore) `HeapType`을 `Small`로 설정한다
- `Small` heap은 초기 힙 크기가 작고 성장 팩터(`heapGrowthSteepnessFactor`, `heapGrowthMaxIncrease`)가 낮다
- `Large` heap(기본값)은 가용 RAM의 `smallHeapRAMFraction` 비율로 최소 힙을 계산하고 공격적으로 성장하여 GC 빈도를 줄인다
- **트레이드오프**: 메모리 ↓, GC 빈도 ↑, CPU 오버헤드 ↑
- 공식 문서 원문: *"Use less memory, but make the worker slower"*
- **결정**: 워커 수가 많을 때(4+)만 `smol: true` 적용. 2~3개는 기본 heap이 더 효율적

### `"open"` 이벤트

- 워커가 생성되어 메시지 수신 준비가 완료되면 발생 (Bun 전용, 브라우저 Web Worker에는 없음)
- **`"open"` 전에 `postMessage()`를 호출해도 메시지는 자동 큐잉된다** — race condition 없음
- `node:worker_threads`에서는 `"open"` → `"online"` 이벤트로 변환됨
- **결정**: ready 게이트로 사용하지 않아도 안전하지만, 워커 상태 추적용으로 활용. 로깅과 헬스체크 기준점으로 사용

### `worker.ref()` / `unref()`

- 기본 상태: ref'd — 활성 워커가 있으면 부모 프로세스가 종료되지 않음
- `unref()`: 부모 프로세스와 워커의 수명 결합을 해제. 부모가 먼저 종료 가능
- 부모 프로세스 종료 시 워커도 함께 종료됨 (같은 프로세스 내 스레드이므로)
- 생성자 단축: `new Worker(url, { ref: false })`
- **결정**: graceful shutdown 시 `unref()` 호출하여 좀비 워커가 프로세스 종료를 블로킹하지 않도록 처리

### `{ preload }` 옵션

- 워커 엔트리 스크립트 실행 **전에** 지정된 모듈을 실행
- 모듈의 사이드 이펙트(글로벌 등록, 플러그인)는 유지되지만 export는 자동으로 사용 불가
- `bunfig.toml`의 preload는 워커에 자동 적용되지 않음 (issue #12608)
- **결정**: AOT 매니페스트가 `registerRuntimeContext()` 사이드 이펙트로 동작하므로 `preload`로 로드 가능. 워커 내부 동적 `import(manifestPath)` 제거

### `{ env }` 옵션

- **병합이 아니라 전체 교체**. `env`를 전달하면 부모의 `process.env`를 완전히 대체
- `env` 미지정 시 부모의 `process.env` **복사본** 사용 (변경이 서로 전파되지 않음)
- `SHARE_ENV` 심볼: 부모-워커 간 `process.env` 공유 (양방향 변경 전파)
- **현재 코드 문제**: `{ ...Bun.env, [WORKER_ID_ENV]: id.toString() }` — 올바른 사용. 전체 env를 복사하고 워커 ID만 추가

### `reusePort`

- **Linux만 동작**. `SO_REUSEPORT` + `SO_REUSEADDR` 소켓 옵션 사용
- 커널 3.9+ 필요. 커널이 4-tuple 해시 기반 분배 (라운드 로빈 아님)
- **macOS/Windows는 옵션이 무시됨** — 에러 없이 바인딩만 되고 로드 밸런싱 안 됨
- **결정**: `workers > 1`일 때 Linux가 아니면 경고 로그 + 에러 발생. 무언 실패 방지

**프로토콜별 reusePort 적용 범위**:

SO_REUSEPORT는 소켓 단위(프로토콜 무관)이므로 TCP 기반 프로토콜은 모두 적용 가능:

| 프로토콜 | reusePort | 비고 |
|----------|-----------|------|
| HTTP/HTTPS/HTTP2 via `Bun.serve()` | O (Linux) | 공식 문서 |
| WebSocket via `Bun.serve()` | O | 같은 소켓. 업그레이드 후 해당 워커 귀속 |
| gRPC (HTTP/2) via `Bun.serve()` | O | 소켓 레벨 동작 |
| Raw TCP via `Bun.listen()` | O | 소스 확인 (옵션 존재, 공식 문서 미기재) |
| UDP via `node:dgram` | X (버그) | issue #14880 — 분배 안 됨 |
| UDP via `Bun.udpSocket()` | X | reusePort 옵션 미노출 |
| Unix domain socket | X | 커널 `AF_UNIX`가 SO_REUSEPORT 미지원 |

**검증 필요: Worker(스레드)에서의 reusePort**:

Bun 공식 클러스터링 가이드는 `Bun.spawn()`(프로세스)를 사용한다. 현재 구현은 `new Worker()`(스레드)이며, 이 조합에서 reusePort가 정상 동작하는지 Bun 측 테스트 기록이 없다. 커널 SO_REUSEPORT는 소켓 단위이므로 이론상 스레드/프로세스 구분 없이 동작하지만, Bun의 usockets 레이어에서의 동작은 미검증이다.

**→ 구현 Phase 최초 단계에서 Worker 스레드 간 reusePort 실제 동작을 검증해야 한다. 결과에 따라 Worker(스레드) 또는 Bun.spawn(프로세스) 결정이 달라진다.**

스레드 vs 프로세스 비교:

| 항목 | Worker (스레드) | Bun.spawn (프로세스) |
|------|----------------|---------------------|
| reusePort 검증 | 미검증 | 공식 권장 |
| 격리 | 세그폴트 시 전체 사망 | 한 프로세스 크래시 무영향 |
| 메모리 | JSC heap만 분리 | 완전 독립 프로세스 |
| IPC 속도 | postMessage (빠름) | IPC 채널 (JSON 직렬화) |
| 종료 안정성 | 실험적 (행 가능) | `kill` 시그널 (안정) |
| OOM 대응 | 프로세스 전체 kill | 해당 프로세스만 kill |

### `"close"` 이벤트

- `CloseEvent` 객체. `event.code`에 종료 코드 포함 (`process.exit(n)` 값 또는 정상 종료 시 `0`)
- 정상 종료와 `process.exit()` 시 발생. 세그폴트 시 발생이 보장되지 않음
- **기존 버그(수정됨)**: `postMessage()` 직후 `process.exit()` 시 close 이벤트 유실 (PR #27225에서 수정)
- **결정**: `"close"` 이벤트를 크래시 감지의 유일한 수단으로 의존하지 않음. `"error"` + `"close"` 조합 사용

### postMessage fast path

세 가지 단계의 fast path 존재:
1. **순수 문자열**: structured clone 완전 우회. 2~241x 빠름
2. **단순 객체**: 프로토타입 미수정, enumerable+configurable data 프로퍼티만, 값이 모두 primitive. 2.1~133x 빠름
3. **단순 객체의 밀집 배열**: 동일 shape 객체 배열 시 구조 캐시로 추가 최적화 (v1.3.10)

**비적격 조건**: 중첩 객체/배열, getter/setter, 비열거 프로퍼티, 특수 타입(Date, Map, Set 등)

**현재 RPC 메시지 `{ id, method, args }` → fast path 비적격**. `args`가 Array이므로 "단순 객체" 조건 불충족. 표준 structured clone으로 처리됨.

**결정**: 현행 유지. RPC는 워커 라이프사이클(init/bootstrap/destroy/getStats)에서만 사용되며 요청 경로(hot path)가 아니므로 fast path 최적화 불필요

### Worker 종료 (termination)

- Bun 공식 문서에서 종료 관련 기능을 실험적(experimental)으로 표기
- 알려진 이슈:
  - top-level `await` 사용 시 워커 행(issue #23102, 미해결)
  - `process.exit()` + `terminate()` 동시 호출 시 크래시 가능(issue #4059)
  - 다수 워커 동시 생성 시 크래시(issue #15942)
  - GC 정리 중 네이티브 바인딩 세그폴트(issue #18198)
- **결정**: `terminate()`에 타임아웃 래퍼 필수. top-level `await` 금지. 워커 스크립트에서 graceful shutdown 프로토콜 구현

---

## Phase 1: 아키텍처 재설계

### 1-0. 클러스터 소유권: Adapter → Application 이전

**현재 구조 (잘못됨)**:

```
Application.start()
  → HttpAdapter.start()
    → if (options.workers > 1)
      → ClusterManager<HttpWorkerRpc>
        → HttpWorker (HTTP 전용)
          → HttpAdapter + HttpServer
```

클러스터 로직이 `HttpAdapter`에 밀결합되어 있다:
- `workers` 옵션이 `HttpServerOptions`에 있음
- `ClusterManager` 생성이 `HttpAdapter.startInternal()`에 있음
- `HttpWorker`가 HTTP 전용 워커 스크립트
- `HttpWorkerRpc`가 HTTP 전용 RPC 타입
- `resolveWorkerScript()`, `resolveManifestPath()`가 HttpAdapter 메서드

다른 어댑터(WebSocket, gRPC 등)는 클러스터를 사용하려면 동일한 로직을 복제해야 한다.

**변경 후 구조**:

```
Application.start()
  → if (options.workers > 1)
    → ClusterManager<ApplicationWorkerRpc>
      → ApplicationWorker (어댑터 무관)
        → runtime.js 로드 → Application 생성 → 모든 어댑터 start
  → else
    → 기존과 동일 (각 어댑터 순차 start)
```

핵심 변경:
- `workers` 옵션이 `CreateApplicationOptions`로 이동
- `Application`이 클러스터 모드 진입 여부를 결정
- 워커는 전체 Application을 실행 — 모든 어댑터가 자동으로 클러스터링
- 개별 어댑터는 클러스터를 모름 (프로토콜 무관 코어 원칙 유지)
- `HttpAdapter`에서 `ClusterManager`, `resolveWorkerScript()`, `resolveManifestPath()`, `workers` 옵션 전부 제거

**`ApplicationWorker` 워커 스크립트**:

```typescript
// packages/core/src/cluster/application-worker.ts
import { ClusterBaseWorker, expose, getRuntimeContext } from '@zipbul/core';

class ApplicationWorker extends ClusterBaseWorker {
  private application: Application;

  override async init(workerId, params) {
    await super.init(workerId, params);

    // 1. AOT 런타임 로드 (preload로 이미 완료됨, 또는 동적 import)
    // 2. RuntimeContext에서 Application 팩토리 획득
    // 3. Application 인스턴스 생성 + 모든 어댑터 attach
  }

  bootstrap() {
    // Application.start() → 모든 어댑터 시작
  }

  async destroy() {
    // Application.stop() → 모든 어댑터 역순 종료
    await this.application.stop();
  }
}
```

**영향 받는 파일**:

| 파일 | 변경 |
|------|------|
| `packages/core/src/application/application.ts` | 클러스터 모드 분기 추가, `workers` 옵션 수용 |
| `packages/core/src/application/interfaces.ts` | `CreateApplicationOptions`에 `workers` 추가 |
| `packages/core/src/cluster/application-worker.ts` | 신규: 어댑터 무관 워커 |
| `packages/http-adapter/src/http-adapter.ts` | 클러스터 관련 코드 전체 제거 |
| `packages/http-adapter/src/http-worker.ts` | 삭제 (application-worker로 대체) |
| `packages/http-adapter/src/interfaces.ts` | `HttpServerOptions.workers` 제거 |
| `packages/http-adapter/src/types.ts` | `HttpWorkerRpc` 제거 |

### 1-1. 워커 라이프사이클 상태 머신

현재 워커 상태가 암묵적이다. 명시적 상태 머신으로 교체한다.

```
Spawning → Ready → Initializing → Running → Draining → Destroying → Terminated
                                     ↓                      ↑
                                   Crashed ────────────────→┘
                                     ↓
                                   Reviving → Spawning → ...
```

```typescript
enum WorkerState {
  Spawning = 'Spawning',
  Ready = 'Ready',
  Initializing = 'Initializing',
  Running = 'Running',
  Draining = 'Draining',
  Destroying = 'Destroying',
  Terminated = 'Terminated',
  Crashed = 'Crashed',
  Reviving = 'Reviving',
}
```

**유효 전이 테이블**:

| From | To | 트리거 |
|------|----|--------|
| Spawning | Ready | `"open"` 이벤트 |
| Spawning | Crashed | error/close 이벤트, startup 타임아웃 |
| Ready | Initializing | init RPC 전송 |
| Ready | Crashed | error/close 이벤트 |
| Initializing | Running | init+bootstrap 완료 + ready 메시지 |
| Initializing | Crashed | error/close, RPC 실패/타임아웃 |
| Running | Draining | drain RPC 전송 (shutdown, 롤링, 리사이클, 소프트 메모리) |
| Running | Crashed | error/close, 헬스체크 3회 실패, 하드 메모리 압박 |
| Draining | Destroying | drain 완료 또는 drain 타임아웃 |
| Draining | Crashed | drain 중 error/close |
| Destroying | Terminated | terminate 완료 또는 terminate 타임아웃(5s) (`terminateInitiated=true`인 close) |
| Destroying | Crashed | `terminateInitiated=false`인 close 이벤트 (비정상 종료) |
| Spawning | Terminated | shutdown 시그널 (non-Running 즉시 종료) |
| Ready | Terminated | shutdown 시그널 (non-Running 즉시 종료) |
| Initializing | Terminated | shutdown 시그널 (non-Running 즉시 종료) |
| Crashed | Reviving | circuit breaker 허용 시 |
| Crashed | Terminated | circuit breaker 차단 또는 shutdown 중 |
| Reviving | Spawning | backoff 타이머 발화 → 새 워커 생성 |
| Reviving | Terminated | shutdown 시그널 또는 circuit breaker 사후 차단 |

**전이 규칙**:
- 모든 전이는 중앙 `transition(slot, from, to)` 함수를 통해서만 수행
- `from`이 현재 상태와 불일치하면 전이 거부 (no-op + 로그)
- 전이 시 이전 상태의 타이머(startup, drain, RPC, backoff) 전부 해제
- Terminated는 종단 상태 — 어떤 전이도 불가

**Destroying 중 error/close 이벤트 처리**:
- `terminateInitiated` 플래그를 Destroying 진입 시 설정
- close 핸들러: `terminateInitiated`가 true면 → Terminated (정상 종료). false면 → Crashed (비정상)
- Destroying에 terminate 타임아웃(5s) 필수. 초과 시 강제 Terminated + unref

**크래시 이벤트 멱등성**:
- 동일 generation에서 첫 error/close만 Crashed 전이. 이후 이벤트는 generation 불일치로 무시

**Generation 증가 시점**:
- `Crashed` 상태 진입 시 `slot.generation++`를 즉시 수행한다. 이 시점 이후 도착하는 구 워커의 모든 이벤트(지연된 close, error, RPC 응답)는 generation 불일치로 무시된다

### 1-2. 워커 슬롯 구조

현재 `Array<ClusterWorker<T> | undefined>` → 구조화된 슬롯 객체로 교체

```typescript
interface ClusterWorkerSlot<T> {
  readonly id: number;
  state: WorkerState;
  generation: number;               // 단조증가. 이벤트 귀속 검증용
  terminateInitiated: boolean;       // Destroying 중 close를 정상으로 판별
  readyReceived: boolean;            // startup timeout vs ready race 방지

  native: Worker | undefined;
  remote: Promisified<T> | undefined;
  rpcProxy: RpcProxy<T> | undefined; // dispose() 호출용

  pendingReplacement: Worker | undefined; // 롤링/리사이클 중 신규 워커 추적

  handlers: Map<string, EventListener>; // 이벤트 리스너 참조 (정리용)
  timers: Set<ReturnType<typeof setTimeout>>; // 활성 타이머 추적 (정리용)

  startupTimer: ReturnType<typeof setTimeout> | undefined; // startup timeout 개별 추적
  healthCheckPending: boolean;           // 이전 헬스체크 RPC 진행 중 여부
  softMemoryLimit: number;               // jitter 적용된 개별 소프트 임계값 (bytes)
  hardMemoryLimit: number;               // jitter 적용된 개별 하드 임계값 (bytes)

  reviveAttempts: number;
  firstCrashTime: number | undefined;
  lastCrashTime: number | undefined;
  lastReadyTime: number | undefined;
  lastStats: ClusterWorkerStats | undefined;
  healthCheckFailures: number;
}
```

**dispose()**: 슬롯의 모든 리소스를 정리한다.
```typescript
function disposeSlot(slot: ClusterWorkerSlot<T>): void {
  // 1. 모든 이벤트 리스너 제거
  for (const [event, handler] of slot.handlers) {
    slot.native?.removeEventListener(event, handler);
  }
  slot.handlers.clear();

  // 2. 모든 타이머 해제
  for (const timer of slot.timers) {
    clearTimeout(timer);
  }
  slot.timers.clear();

  // 3. pending RPC 전부 reject
  slot.rpcProxy?.dispose();

  // 4. pendingReplacement 정리
  if (slot.pendingReplacement) {
    slot.pendingReplacement.terminate();
    slot.pendingReplacement = undefined;
  }

  // 5. 참조 해제
  slot.native = undefined;
  slot.remote = undefined;
  slot.rpcProxy = undefined;
}
```

### 1-3. 생성자에서 스폰 제거 → lazy init

현재 문제: `constructor`에서 즉시 `spawnWorker()` → `init()`/`bootstrap()` 호출 전에 워커가 실행됨

변경:
```
constructor(options) → 슬롯 배열만 생성 (state: Spawning, native: undefined)
init(params)        → 워커 스폰 + init RPC
bootstrap(params)   → bootstrap RPC
```

### 1-4. `"open"` 이벤트 기반 ready 추적

`spawnWorker()` 내에서 `"open"` 이벤트 리스너 등록. 메시지는 `"open"` 전에도 자동 큐잉되므로 RPC 블로킹은 불필요하지만, 슬롯 상태를 `Ready`로 전이하는 기준점으로 사용.

```typescript
native.addEventListener('open', () => {
  slot.state = WorkerState.Ready;
  slot.lastReadyTime = Date.now();
});
```

### 1-5. Worker Group 모델

#### 어댑터 클러스터링 전략

각 어댑터가 자신의 클러스터링 특성을 선언한다:

```typescript
enum ClusterStrategy {
  /**
   * 포트 공유(reusePort)로 수평 확장 가능.
   * N개 워커에서 동일 인스턴스 실행. 커널이 트래픽 분배.
   * 예: HTTP, gRPC Unary, MQ Consumer
   */
  Shared = 'Shared',

  /**
   * 정확히 1개 워커에서만 실행.
   * 중복 실행이 부작용을 발생시키는 어댑터.
   * 예: Cron, Leader Election, Scheduler
   */
  Exclusive = 'Exclusive',
}
```

`Adapter` 베이스 클래스에 기본값 제공:

```typescript
abstract class Adapter {
  /** 클러스터 모드에서의 스케일링 전략. 서브클래스가 오버라이드. */
  readonly clusterStrategy: ClusterStrategy = ClusterStrategy.Shared;
}
```

Exclusive 어댑터 예시:

```typescript
class CronAdapter extends Adapter {
  readonly clusterStrategy = ClusterStrategy.Exclusive;
}
```

#### Worker Group 정의

```typescript
interface WorkerGroupConfig {
  /** 이 그룹에 속할 어댑터 클래스들 */
  readonly adapters: readonly AdapterClass[];
  /** 워커 수. 생략 시 Shared=사용자 지정값, Exclusive=1 */
  readonly workers?: number;
}
```

#### 사용자 API — 3단계 설정

**레벨 0 — 제로 설정**:

```typescript
createApplication(AppModule);
// → 싱글 프로세스. 클러스터 없음.
```

**레벨 1 — 워커 수만 지정**:

```typescript
createApplication(AppModule, { workers: 4 });
// → 프레임워크가 자동 그룹핑:
//   Shared 어댑터들 → 1개 그룹, 4 workers
//   Exclusive 어댑터들 → 1개 그룹, 1 worker
```

자동 그룹핑 알고리즘:
```
1. 모든 어댑터를 clusterStrategy로 분류
2. Shared 어댑터들 → "shared" 그룹 (workers: N)
3. Exclusive 어댑터들 → "exclusive" 그룹 (workers: 1)
4. Exclusive 어댑터가 없으면 그룹 1개
5. 총 워커 수 = N + (Exclusive 존재 시 1)
```

**레벨 2 — 명시적 그룹 지정**:

```typescript
createApplication(AppModule, {
  cluster: [
    { adapters: [HttpAdapter], workers: 6 },
    { adapters: [WebSocketAdapter], workers: 2 },
    { adapters: [CronAdapter] },  // workers 생략 → Exclusive이므로 1
  ],
});
```

명시적 그룹에서 `workers` 생략 시: 해당 그룹 내 어댑터 중 하나라도 `Exclusive`이면 1, 아니면 `navigator.hardwareConcurrency`.

#### 총 워커 수 검증

```typescript
const MAX_WORKERS = navigator.hardwareConcurrency;

function validateTotalWorkers(groups: ResolvedWorkerGroup[]): void {
  const total = groups.reduce((sum, g) => sum + g.workers, 0);

  if (total > MAX_WORKERS) {
    throw new Error(
      `Total workers (${total}) exceeds available cores (${MAX_WORKERS}). ` +
      `Reduce worker counts to avoid context switching overhead.`
    );
  }
}
```

#### 마스터 → Worker Group 실행 구조

```
Application.start() (마스터)
  → resolveWorkerGroups()  // 어댑터 분류 → 그룹 생성
  → for each group:
    → new ClusterManager(group)
    → clusterManager.init({ adapterNames: group.adapterNames })
    → clusterManager.bootstrap()
  → startHealthCheck()
  → registerSignalHandlers()
```

각 그룹의 ClusterManager가 독립적으로 워커를 관리한다. 그룹 간 워커는 격리되어 있다.

#### ApplicationWorker의 어댑터 필터

워커는 init RPC에서 자신이 부트할 어댑터 목록을 받는다:

```typescript
// ApplicationWorker.init()
async init(workerId, params) {
  await super.init(workerId, params);

  const runtimeCtx = getRuntimeContext();
  const app = new Application(runtimeCtx.container);

  // params.adapterNames: 이 워커 그룹에 할당된 어댑터 이름 목록
  // Application이 attach된 어댑터 중 해당하는 것만 start
  await app.startForGroup(params.adapterNames);

  this.application = app;
}
```

`Application.startForGroup(names)`:
```typescript
async startForGroup(adapterNames: readonly string[]): Promise<void> {
  const filter = new Set(adapterNames);

  // startOrder에서 해당 어댑터만 필터링
  const filteredOrder = this.startOrder.filter(
    entry => filter.has(entry.adapterClass.name)
  );

  for (const entry of filteredOrder) {
    entry.adapter.initializePipeline(this.container);
    await entry.adapter.start(context);
  }
}
```

### 1-6. 시스템 일관성 불변식

12개 기능이 하나의 시스템으로 동작하기 위한 3가지 구조적 불변식:

**불변식 A — 중앙집중 상태 머신 + 전이 가드**

모든 기능(헬스체크, 리사이클, 롤링, 메모리, 시그널)이 동일한 `transition(slot, from, to)` 함수를 통해서만 상태를 변경한다. 이 함수가 from ≠ currentState이면 전이를 거부하므로, 두 기능이 동시에 같은 워커를 조작할 수 없다.

예시: 헬스체크가 Running → Crashed를 시도하는 순간 리사이클이 Running → Draining을 먼저 성공했다면, 헬스체크의 전이는 거부된다.

**불변식 B — 그룹 단위 교체 semaphore**

한 그룹 내에서 동시에 진행되는 교체 작업(spawn replacement)은 최대 1개다. 헬스체크 교체, 리사이클, 롤링 리스타트, 메모리 압박 교체 모두 이 semaphore를 획득해야 한다.

```typescript
interface WorkerGroup {
  replacementInProgress: boolean; // semaphore
  // ...
}
```

교체 요청이 들어왔을 때 `replacementInProgress === true`면 대기열에 넣거나 건너뛴다 (헬스체크 교체는 건너뜀, 롤링은 대기).

**불변식 C — 워커 세대(generation) ID**

슬롯별 단조증가 `generation` 카운터. 워커가 새로 생성될 때마다 증가. 모든 이벤트 핸들러, 타이머 콜백, RPC 응답 핸들러가 처리 전에 `slot.generation === expectedGeneration`을 검증한다.

```typescript
// 이벤트 핸들러 등록 시
const gen = slot.generation;
const handler = (event: Event) => {
  if (slot.generation !== gen) return; // 구 워커 이벤트 무시
  // ... 실제 처리
};
```

이로써 구 워커의 지연된 이벤트가 신규 워커에 오귀속되는 문제를 차단한다.

### 1-7. Startup 타임아웃

워커 전체 초기화(spawn → open → init → bootstrap → Running) 과정에 통합 타임아웃:

```typescript
const STARTUP_TIMEOUT_MS = 60_000;

async initWorker(slot: ClusterWorkerSlot<T>): Promise<void> {
  await Promise.race([
    this.doInitSequence(slot),
    timeout(STARTUP_TIMEOUT_MS, new WorkerStartupTimeoutError(slot.id, STARTUP_TIMEOUT_MS)),
  ]);
}
```

타임아웃 시 해당 슬롯을 `Crashed` 상태로 전이하고 revive 로직 진입.

---

## Phase 2: RPC 재설계

### 2-1. RPC 타임아웃

현재 치명적 결함: pending Promise가 영원히 해결되지 않을 수 있음

```typescript
const RPC_TIMEOUT_MS = 30_000;

// wrap() 내부
const timer = setTimeout(() => {
  pending.delete(id);
  reject(new RpcTimeoutError(method, RPC_TIMEOUT_MS));
}, RPC_TIMEOUT_MS);

// 응답 수신 시
clearTimeout(timer);
```

`RpcPending` 인터페이스에 `timer` 필드 추가:
```typescript
interface RpcPending {
  resolve(value: RpcResult): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}
```

### 2-2. pending 정리

워커 종료 시 해당 워커의 모든 pending RPC를 일괄 reject:

```typescript
function rejectAllPending(pending: Map<string, RpcPending>, reason: string): void {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(new RpcAbortedError(reason));
    pending.delete(id);
  }
}
```

`wrap()` 반환 시 정리 핸들도 함께 반환하도록 구조 변경:

```typescript
interface RpcProxy<T> {
  api: Promisified<T>;
  dispose(): void;  // 모든 pending reject + 이벤트 리스너 제거
}
```

### 2-3. postMessage fast path 최적화

현재 메시지 `{ id, method, args: [...] }` → args가 Array이므로 fast path 비적격.

**방안 A**: args를 flat 프로퍼티로 풀기
```typescript
// Before
{ id: "uuid", method: "init", args: [0, { entryModule: ... }] }

// After — 단일 인자가 primitive인 경우 fast path 적격
{ id: "uuid", method: "init", arg0: 0 }
```

**방안 B**: 현행 유지. RPC 호출은 초기화/종료 시에만 발생하므로 성능 영향 미미.

**결정**: 방안 B 채택. RPC는 워커 라이프사이클(init/bootstrap/destroy/getStats)에서만 사용되며 요청 경로(hot path)가 아니다. 불필요한 복잡성 회피.

### 2-4. `expose()` 메서드 화이트리스트

현재: `targetObject[payload.method]`로 임의 메서드 호출 가능 (`toString`, `constructor` 등)

```typescript
export function expose<T extends Record<string, RpcCallable>>(
  targetObject: T,
  allowedMethods: ReadonlyArray<keyof T>,
): void {
  const methodSet = new Set<string>(allowedMethods.map(String));

  // ...
  if (!methodSet.has(payload.method)) {
    throw new Error(`Method "${payload.method}" is not exposed`);
  }
}
```

### 2-5. 에러 직렬화 개선

현재: `err.message`만 전달 → 워커 측 스택 트레이스 소실

```typescript
interface RPCResponse {
  id: string;
  result?: RpcResult;
  error?: {
    message: string;
    stack?: string;
    name: string;
  };
}
```

---

## Phase 3: 크래시 복구 재설계

### 3-1. 이벤트 중복 처리 방지

워커 크래시 시 `error`, `messageerror`, `close` 이벤트가 복수 발생할 수 있다.

```typescript
private handleCrash(event: string, slot: ClusterWorkerSlot<T>, error: Event): void {
  // 불변식 A: 중앙 transition 함수를 통해서만 상태 변경
  const transitioned = transition(slot, slot.state, WorkerState.Crashed);

  if (!transitioned) {
    return;  // 이미 Crashed/Destroying/Terminated — 전이 거부됨
  }

  // 불변식 C: Crashed 진입 시 즉시 generation 증가
  slot.generation++;
  slot.lastCrashTime = Date.now();

  // pending RPC 전부 reject + 리스너 정리
  disposeSlot(slot);

  // 이후 복구 로직 (shouldRevive → reviveWorker)
}
```

### 3-2. `destroyWorker` → terminate 우선, RPC 대기 안 함

현재 치명적 문제: 죽은 워커에 `remote.destroy()` RPC 호출 → 응답 불가 → 영원히 블로킹

```typescript
private async terminateWorker(slot: ClusterWorkerSlot<T>): Promise<void> {
  // 불변식 A: 중앙 transition 함수를 통해서만 상태 변경
  slot.terminateInitiated = true;
  transition(slot, slot.state, WorkerState.Destroying);

  // 1. pending RPC 전부 reject
  slot.rpcProxy?.dispose();

  // 2. graceful destroy 시도 (Crashed 상태가 아닌 경우에만)
  if (slot.remote && !slot.terminateInitiated) {
    // 주의: Crashed에서 Destroying로 온 경우 워커가 이미 죽었으므로 RPC 불가
    // terminateInitiated는 Destroying 진입 시 true이므로 이 분기는
    // graceful shutdown 경로에서만 진입 (Running → Draining → Destroying)
  }

  // 3. unref + terminate
  if (slot.native) {
    slot.native.unref();
    slot.native.terminate();
  }

  // 4. close 이벤트 또는 5s 타임아웃으로 Terminated 전이 (Phase 3-7)
  // 여기서 동기적으로 Terminated 설정하지 않음 — close 핸들러가 처리
}
```

핵심 변경:
- 크래시 상태에서는 RPC destroy 시도 자체를 건너뜀
- `terminate()` 전 `unref()` 호출하여 프로세스 종료 블로킹 방지
- 타임아웃 없이 `remote.destroy()`를 호출하지 않음

### 3-3. revive 추적 + graceful shutdown 대기

```typescript
private readonly reviveControllers = new Map<number, AbortController>();

private reviveWorker(slot: ClusterWorkerSlot<T>): void {
  if (this.destroying || this.reviveControllers.has(slot.id)) {
    return;
  }

  const controller = new AbortController();
  this.reviveControllers.set(slot.id, controller);

  slot.state = WorkerState.Reviving;

  // backOff에 signal 전달하여 취소 가능하게
  void this.reviveLoop(slot, controller.signal);
}

async destroy(): Promise<void> {
  this.destroying = true;

  // 1. 모든 revive 작업 취소
  for (const controller of this.reviveControllers.values()) {
    controller.abort();
  }
  this.reviveControllers.clear();

  // 2. 모든 워커 종료
  await Promise.all(this.slots.map(slot => this.terminateWorker(slot)));
}
```

### 3-4. 크래시 빈도 제한 (circuit breaker)

같은 워커가 짧은 시간에 반복 크래시하면 무한 revive 루프를 방지:

```typescript
const CRASH_WINDOW_MS = 60_000;
const MAX_CRASHES_IN_WINDOW = 5;

private shouldRevive(slot: ClusterWorkerSlot<T>): boolean {
  if (slot.reviveAttempts >= MAX_CRASHES_IN_WINDOW) {
    const timeSinceFirst = Date.now() - (slot.firstCrashTime ?? 0);

    if (timeSinceFirst < CRASH_WINDOW_MS) {
      this.logger.error(`Worker #${slot.id} crashed ${slot.reviveAttempts} times in ${timeSinceFirst}ms — giving up`);
      return false;
    }

    // 윈도우 밖이면 카운터 리셋
    slot.reviveAttempts = 0;
    slot.firstCrashTime = undefined;
  }

  return true;
}
```

### 3-5. 이벤트 리스너 정리

워커 종료 시(crash, graceful, timeout 모든 경로) 반드시 `disposeSlot(slot)` 호출.

- `spawnWorker()`에서 등록하는 모든 리스너(`error`, `messageerror`, `close`, `open`, `message`)를 named function으로 등록하고 `slot.handlers`에 저장
- terminate/crash 경로에서 `disposeSlot()` 호출 → 리스너 전부 제거, 타이머 전부 해제, pending RPC 전부 reject, pendingReplacement terminate
- 리스너 누수 방지: 개발 모드에서 슬롯별 리스너 수 assertion

### 3-6. 클러스터 전체 크래시율 감지

Phase 3-4의 per-worker circuit breaker에 추가하여, 그룹 단위 circuit breaker:

```typescript
interface GroupCircuitBreaker {
  crashTimestamps: number[];         // 슬라이딩 윈도우
  maxIntensity: number;              // 기본 5
  periodMs: number;                  // 기본 60_000
  tripped: boolean;
}
```

```typescript
private recordGroupCrash(group: WorkerGroup): boolean {
  const now = Date.now();
  const breaker = group.circuitBreaker;

  breaker.crashTimestamps.push(now);
  breaker.crashTimestamps = breaker.crashTimestamps.filter(
    t => now - t < breaker.periodMs
  );

  if (breaker.crashTimestamps.length >= breaker.maxIntensity) {
    breaker.tripped = true;

    // 해당 그룹의 모든 Reviving 워커 즉시 Terminated 전이
    for (const slot of group.slots) {
      if (slot.state === WorkerState.Reviving) {
        this.cancelRevive(slot);
        transition(slot, WorkerState.Reviving, WorkerState.Terminated);
      }
    }

    this.logger.fatal(
      `Group "${group.name}" circuit breaker tripped: ` +
      `${breaker.crashTimestamps.length} crashes in ${breaker.periodMs}ms`
    );

    // 생존 워커는 유지 (부분 서비스 > 전체 중단)
    this.emit('circuitBreakerTripped', { group: group.name });

    return false; // revive 불허
  }

  return true;
}
```

롤링 리스타트 실패도 crash counter에 반영하여 배포 불량을 감지한다.

### 3-7. Destroying 타임아웃

Bun Worker termination이 실험적이므로 `terminate()`가 hang할 수 있다.

```typescript
// terminateWorker() 내부
slot.terminateInitiated = true;
transition(slot, slot.state, WorkerState.Destroying);

if (slot.native) {
  slot.native.unref();
  slot.native.terminate();
}

// terminate 완료를 close 이벤트로 감지하되, 5초 타임아웃
const terminateTimer = setTimeout(() => {
  if (slot.state === WorkerState.Destroying) {
    transition(slot, WorkerState.Destroying, WorkerState.Terminated);
    disposeSlot(slot);
  }
}, 5_000);
slot.timers.add(terminateTimer);
```

---

## Phase 4: 플랫폼 안전장치

### 4-1. Linux 외 클러스터 모드 경고

`reusePort`가 macOS/Windows에서 무시되므로 클러스터 모드가 실질적으로 동작하지 않음:

```typescript
// Application.start() 또는 ClusterManager 생성자에서
private validatePlatform(workerCount: number): void {
  if (workerCount <= 1) {
    return;
  }

  if (process.platform !== 'linux') {
    throw new Error(
      `Cluster mode (workers: ${workerCount}) requires Linux. ` +
      `${process.platform} does not support SO_REUSEPORT load balancing. ` +
      `Use workers: 1 for single-process mode.`
    );
  }
}
```

### 4-2. `smol` 옵션 조건부 적용

```typescript
private resolveSmol(workerCount: number): boolean {
  return workerCount >= 4;
}
```

워커 수 < 4: 기본 Large heap → GC 빈도 낮음, 처리량 우선
워커 수 >= 4: Small heap → 메모리 절약 우선 (GC 오버헤드는 멀티코어로 분산)

### 4-3. `preload` 옵션으로 AOT 매니페스트 로드

현재: 워커 내부에서 동적 `import(manifestPath)` 호출
변경: `new Worker(script, { preload: [manifestPath] })`로 엔트리 전 로드

```typescript
// ClusterManager.spawnWorker() — @zipbul/core
private spawnWorker(slot: ClusterWorkerSlot<T>): Worker {
  const preload = this.manifestPath ? [this.manifestPath] : [];

  return new Worker(this.script.href, {
    env: { ...Bun.env, [WORKER_ID_ENV]: slot.id.toString() },
    smol: this.resolveSmol(this.slots.length),
    preload,
  });
}
```

이에 따라 `ApplicationWorker.init()`에서 동적 import 제거 가능.

### 4-4. top-level `await` 금지 가드

Bun 워커에서 top-level `await`는 행을 유발한다 (issue #23102, 미해결).
워커 스크립트(`application-worker.ts`)가 top-level `await`를 사용하지 않는지 확인.

워커 스크립트는 동기적으로 `expose()` 호출만 수행. init/bootstrap/destroy는 RPC 콜백 내에서 async 실행되므로 안전.

---

## Phase 5: 헬스체크

### 5-1. 주기적 heartbeat

```typescript
private startHealthCheck(intervalMs: number = 10_000): void {
  this.healthCheckTimer = setInterval(() => {
    void this.checkWorkerHealth();
  }, intervalMs);
}

private async checkWorkerHealth(): Promise<void> {
  const tasks = this.slots
    .filter(slot => slot.state === WorkerState.Running)
    .map(async slot => {
      try {
        const stats = await Promise.race([
          slot.remote.getStats(),
          timeout(5_000),
        ]);

        slot.lastStats = stats;
      } catch {
        this.logger.warn(`Worker #${slot.id} health check failed`);
        this.handleCrash('healthcheck', slot, new Error('Health check timeout'));
      }
    });

  await Promise.all(tasks);
}
```

### 5-2. CPU 통계 계산 수정

현재 문제: `totalCpu / 1_000_000`은 경과 시간 대비 비율이 아님

```typescript
getStats(): ClusterWorkerStats {
  const now = process.hrtime.bigint();
  const elapsed = Number(now - this.prevTime) / 1_000_000_000; // 초 단위

  const currentCpu = process.cpuUsage(this.prevCpu);
  const totalCpuSeconds = (currentCpu.user + currentCpu.system) / 1_000_000; // 초 단위

  this.prevCpu = process.cpuUsage();
  this.prevTime = process.hrtime.bigint();

  return {
    cpu: elapsed > 0 ? Math.min(1, totalCpuSeconds / elapsed) : 0,
    memory: process.memoryUsage.rss(),
  };
}
```

### 5-3. 통합 모니터링 루프

헬스체크(5-1)와 메모리 압박 감시를 별도 타이머로 실행하면 동일 워커에 `getStats` RPC가 중복 호출된다. 단일 폴링 루프로 통합:

```typescript
private async monitorWorkers(): Promise<void> {
  for (const slot of this.slots) {
    if (slot.state !== WorkerState.Running) continue;

    // 이전 헬스체크가 아직 pending이면 건너뜀 (back-pressure)
    if (slot.healthCheckPending) {
      slot.healthCheckFailures++;
      this.evaluateHealth(slot);
      continue;
    }

    slot.healthCheckPending = true;

    try {
      const stats = await Promise.race([
        slot.remote.getStats(),
        timeout(5_000),
      ]);

      slot.healthCheckPending = false;
      slot.healthCheckFailures = 0;
      slot.lastStats = stats;

      // 메모리 압박 평가 (같은 stats 데이터 사용)
      this.evaluateMemoryPressure(slot, stats);
    } catch {
      slot.healthCheckPending = false;
      slot.healthCheckFailures++;
      this.evaluateHealth(slot);
    }
  }
}
```

### 5-4. 메모리 압박 대응

`getStats` 응답의 RSS를 기반으로 2단계 대응:

```typescript
interface MemoryThresholds {
  softPercent: number;  // 기본 80 — graceful 재활용
  hardPercent: number;  // 기본 95 — 즉시 terminate
  limitBytes: number;   // 워커당 메모리 상한 (사용자 설정)
}
```

```typescript
private evaluateMemoryPressure(slot: ClusterWorkerSlot<T>, stats: ClusterWorkerStats): void {
  const usage = stats.memory / this.memoryThresholds.limitBytes;

  if (usage >= this.memoryThresholds.hardPercent / 100) {
    // 하드: 즉시 Crashed 처리 (drain 건너뜀)
    this.logger.error(`Worker #${slot.id} hard memory limit: ${stats.memory} bytes`);
    this.handleCrash('memory-hard', slot);
    return;
  }

  if (usage >= this.memoryThresholds.softPercent / 100) {
    // 소프트: graceful 재활용 (drain → replace)
    // 교체 semaphore 확인
    if (!this.group.replacementInProgress) {
      this.logger.warn(`Worker #${slot.id} soft memory limit: ${stats.memory} bytes`);
      this.recycleWorker(slot);
    }
  }
}
```

워커별 임계값에 jitter 적용 (Unicorn 패턴):
```typescript
// 워커 생성 시 개별 임계값 할당
slot.softMemoryLimit = randomBetween(softBytes * 0.9, softBytes * 1.1);
slot.hardMemoryLimit = randomBetween(hardBytes * 0.95, hardBytes * 1.05);
```

### 5-5. Readiness Probe: 2단계

| 단계 | 이벤트 | 의미 | 트리거 |
|------|--------|------|--------|
| Process Ready | `"open"` 이벤트 | JSC 스레드 초기화 완료 | 상태: Spawning → Ready |
| Application Ready | `{ type: 'ready' }` postMessage | AOT 로드 + 어댑터 바인딩 완료 | 상태: Initializing → Running |

**Application Ready만이** 다음 동작의 트리거:
- startup 타임아웃 해제
- 롤링 리스타트에서 구 워커 drain 시작
- 헬스체크 대상 등록

ready 메시지와 startup 타임아웃의 race condition 방지:
```typescript
// ready 핸들러
if (slot.generation !== expectedGeneration) return;
slot.readyReceived = true;
clearTimeout(slot.startupTimer);
transition(slot, WorkerState.Initializing, WorkerState.Running);

// startup 타임아웃 핸들러
if (slot.readyReceived) return;  // ready가 먼저 도착한 경우
if (slot.generation !== expectedGeneration) return;
transition(slot, slot.state, WorkerState.Crashed);
```

---

## Phase 6: 라이프사이클 운영

### 6-1. 커넥션 드레이닝

`Adapter` 베이스 클래스에 `drain()` 훅 추가:

```typescript
abstract class Adapter {
  /**
   * 새 커넥션 수신을 중단하고 진행 중인 요청 완료를 대기한다.
   * 각 어댑터가 프로토콜에 맞게 구현.
   *
   * @param timeoutMs - drain 최대 대기 시간
   */
  abstract drain(timeoutMs: number): Promise<void>;
}
```

**HTTP 어댑터 구현**:
```typescript
async drain(timeoutMs: number): Promise<void> {
  if (!this.httpServer) return;

  // server.stop()은 Bun 내장 드레이닝 — 새 커넥션 중단, 진행 중 요청 대기
  // 단, 타임아웃 파라미터가 없으므로 Promise.race로 감싼다
  await Promise.race([
    this.httpServer.stop(),       // graceful (무한 대기)
    timeout(timeoutMs),
  ]);

  // 타임아웃 시 강제 종료
  if (this.httpServer.pendingRequests > 0 || this.httpServer.pendingWebSockets > 0) {
    this.httpServer.stop(true);   // force
  }
}
```

**WebSocket 어댑터 구현**: close frame + 재접속 힌트 전송 후 대기

**drain 훅 실패 처리**: drain()이 throw하면 drain 타임아웃과 동일 처리 (catch → Destroying 진입)

### 6-2. 시그널 핸들링

마스터 프로세스가 OS 시그널을 수신하고 전체 클러스터 shutdown을 오케스트레이션:

```typescript
// Application.start() 내에서, 클러스터 모드일 때
private registerSignalHandlers(): void {
  const shutdown = () => void this.shutdownCluster();

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
```

Web Worker는 OS 시그널을 직접 수신할 수 없다. 마스터가 `drain` RPC로 전달한다.

**startup 중 시그널**: `startupPhase` 플래그가 true일 때는 drain 건너뜀. 아직 커넥션이 없으므로 즉시 terminate.

### 6-3. Graceful Shutdown 오케스트레이션

```typescript
private async shutdownCluster(): Promise<void> {
  if (this.isShuttingDown) return;
  this.isShuttingDown = true;

  // 1. 모든 그룹의 destroying 플래그를 원자적으로 설정
  for (const group of this.groups.values()) {
    group.clusterManager.destroying = true;
  }

  // 2. 롤링 리스타트/리사이클 중이면 취소
  for (const group of this.groups.values()) {
    group.clusterManager.cancelRollingRestart();
  }

  // 3. 모든 Reviving 워커의 backoff 타이머 취소 → Terminated
  for (const group of this.groups.values()) {
    group.clusterManager.cancelAllRevives();
  }

  // 4. Spawning/Ready/Initializing 워커 즉시 terminate
  for (const group of this.groups.values()) {
    group.clusterManager.terminateNonRunningWorkers();
  }

  // 5. Running 워커에 drain (모든 그룹 병렬)
  const drainPromises = [];
  for (const group of this.groups.values()) {
    drainPromises.push(group.clusterManager.drainAllRunning(this.drainTimeoutMs));
  }
  await Promise.all(drainPromises);

  // 6. 남은 워커 force terminate
  for (const group of this.groups.values()) {
    await group.clusterManager.forceTerminateAll();
  }

  // 7. 마스터 자원 정리
  clearInterval(this.monitorTimer);
  process.exit(0);
}
```

**핵심**: shutdown 타임아웃은 그룹별이 아니라 전역. 모든 그룹이 병렬 drain하므로 총 시간 = max(각 그룹 drain 시간), 최대 `drainTimeoutMs`.

### 6-4. 롤링 리스타트

그룹 내 워커를 하나씩 교체하여 무중단 업데이트.

**Shared 어댑터 그룹**: spawn new → ready → drain old → terminate old (양쪽 동시 수신 허용, reusePort 분배)

**Exclusive 어댑터 그룹**: drain old → terminate old → spawn new → ready (동시 실행 금지. 잠깐의 서비스 공백은 Exclusive의 본질 — Cron/Scheduler 등 실시간 트래픽 미수신 — 과 부합)

```typescript
async rollingRestart(group: WorkerGroup): Promise<void> {
  if (group.rollingRestartInProgress) {
    throw new Error('Rolling restart already in progress');
  }

  group.rollingRestartInProgress = true;
  const isExclusive = group.strategy === ClusterStrategy.Exclusive;
  let consecutiveFailures = 0;

  try {
    for (const slot of group.slots) {
      if (this.isShuttingDown) break;

      await this.acquireReplacementLock(group);

      try {
        if (isExclusive) {
          // Exclusive: 구 워커 먼저 정리 → 새 워커 생성 (중복 실행 방지)
          await this.drainWorker(slot, this.drainTimeoutMs);
          await this.terminateWorker(slot);

          const newWorker = this.spawnWorker(slot);
          slot.pendingReplacement = newWorker;
          await this.waitForReady(newWorker, this.startupTimeoutMs);
          this.promoteReplacement(slot, newWorker);
        } else {
          // Shared: 새 워커 먼저 준비 → 구 워커 정리 (무중단)
          const newWorker = this.spawnWorker(slot);
          slot.pendingReplacement = newWorker;
          await this.waitForReady(newWorker, this.startupTimeoutMs);

          await this.drainWorker(slot, this.drainTimeoutMs);
          await this.terminateWorker(slot);
          this.promoteReplacement(slot, newWorker);
        }

        consecutiveFailures = 0;
      } catch {
        if (slot.pendingReplacement) {
          slot.pendingReplacement.terminate();
          slot.pendingReplacement = undefined;
        }

        consecutiveFailures++;
        this.recordGroupCrash(group);

        if (consecutiveFailures >= 2) {
          this.logger.error(`Rolling restart aborted: ${consecutiveFailures} consecutive failures`);
          this.emit('rollingRestartFailed', { group: group.name });
          break;
        }
      } finally {
        this.releaseReplacementLock(group);
      }
    }
  } finally {
    group.rollingRestartInProgress = false;
  }
}
```

### 6-5. 워커 재활용

3가지 트리거, 전부 jitter 부여. 재활용 = 교체 semaphore 획득 → 새 워커 spawn → ready → 구 워커 drain → terminate.

```typescript
interface RecyclePolicy {
  maxRequests?: { min: number; max: number };     // 기본 비활성
  maxLifetimeMs?: { min: number; max: number };   // 기본 비활성
  maxRssBytes?: { min: number; max: number };     // 메모리 압박 5-4와 통합
}
```

- 그룹 내 동시 재활용 1개 제한 (교체 semaphore)
- 재활용 절차는 롤링 리스타트의 단일 워커 교체와 동일
- maxRssBytes는 Phase 5-4 메모리 압박의 soft threshold와 통합하여 이중 적용 방지

### 6-6. Exclusive 어댑터 가용성 보강

Exclusive 그룹(워커 1개)은 크래시 시 서비스 완전 불능. 대응:

- Exclusive 그룹의 revive backoff 초기값을 100ms로 단축 (Shared 기본 300ms)
- Exclusive 그룹의 circuit breaker intensity를 더 관대하게 설정 (기본 10, period 120s) — 1개 워커라 크래시 빈도가 자연적으로 낮음

---

## Phase 7: 파일 구조 변경

### 변경 전

```
packages/core/src/cluster/
├── cluster-manager.ts
├── cluster-base-worker.ts
├── ipc.ts
├── ipc.spec.ts
├── interfaces.ts
├── types.ts
└── index.ts
```

### 변경 후

```
packages/core/src/cluster/
├── cluster-manager.ts          # 재설계된 매니저
├── cluster-base-worker.ts      # CPU 통계 수정
├── application-worker.ts       # 어댑터 무관 워커 (HttpWorker 대체)
├── rpc-proxy.ts                # wrap() + dispose + 타임아웃 (ipc.ts에서 분리)
├── rpc-expose.ts               # expose() + 화이트리스트 (ipc.ts에서 분리)
├── worker-state.ts             # WorkerState enum + 전이 로직
├── enums.ts                    # WorkerState enum
├── interfaces.ts               # 정리 (미사용 ClusterSlot 제거)
├── types.ts                    # RpcProxy, ApplicationWorkerRpc 등
├── errors.ts                   # RpcTimeoutError, RpcAbortedError
├── cluster-manager.spec.ts     # 매니저 통합 테스트
├── application-worker.spec.ts  # 워커 단위 테스트
├── rpc-proxy.spec.ts           # RPC 단위 테스트 (ipc.spec.ts 이전)
├── rpc-expose.spec.ts          # expose 단위 테스트
└── index.ts                    # public barrel
```

---

## Phase 8: 테스트 계획

### 단위 테스트

| 대상 | 테스트 항목 |
|------|-------------|
| `rpc-proxy` | 타임아웃 → reject, 응답 → resolve, dispose → 전체 reject, 중복 응답 무시 |
| `rpc-expose` | 허용 메서드 호출, 비허용 메서드 reject, 에러 직렬화(stack 포함) |
| `worker-state` | 유효 전이 허용, 무효 전이 에러, 모든 상태 전이 경로, Draining 포함 |
| `cluster-base-worker` | CPU 통계 정확성 (경과 시간 대비 비율) |
| `generation ID` | 구 워커 이벤트가 신규 워커에 오귀속되지 않음 |
| `disposeSlot` | 리스너 전부 제거, 타이머 전부 해제, pending RPC reject, pendingReplacement terminate |

### 통합 테스트

| 시나리오 | 검증 |
|----------|------|
| 정상 라이프사이클 | Spawning → Ready → Initializing → Running → Draining → Destroying → Terminated |
| 워커 크래시 + 자동 복구 | `process.exit(1)` → Crashed → Reviving → Running |
| 크래시 빈도 제한 (per-worker) | 60초 내 5회 크래시 → revive 중단 |
| 크래시 빈도 제한 (per-group) | 그룹 내 다수 워커 크래시 → circuit breaker trip → Reviving 전부 Terminated |
| graceful shutdown | 모든 상태(Spawning/Initializing/Running/Reviving) 처리 확인, 누수 워커 없음 |
| shutdown 중 Reviving | backoff 타이머 취소, 새 워커 spawn 안 됨 |
| shutdown 중 롤링 리스타트 | 롤링 취소 → pendingReplacement terminate → 정상 shutdown |
| RPC 타임아웃 | 30초 후 reject |
| startup 타임아웃 vs ready race | ready 먼저 도착 → Running, 타임아웃 무시. 타임아웃 먼저 → Crashed |
| Destroying 중 close 이벤트 | `terminateInitiated=true` → Terminated (Crashed 아님) |
| 롤링 리스타트 | 순차 교체, ready 후 drain, 실패 시 구 워커 유지 |
| 롤링 리스타트 연속 실패 | 2회 실패 → 중단 + error 이벤트 |
| 교체 semaphore | 헬스체크 교체 + 리사이클 동시 요청 → 하나만 진행 |
| 메모리 소프트 | RSS 80% → drain + replace |
| 메모리 하드 | RSS 95% → 즉시 Crashed (drain 건너뜀) |
| 커넥션 드레이닝 | drain 중 pendingRequests 감소 → drain 완료. 타임아웃 시 force stop |
| SIGTERM 처리 | 마스터 수신 → 전체 그룹 drain → terminate → exit(0) |
| Worker Group 자동 분류 | Shared → main 그룹, Exclusive → exclusive 그룹 |
| 어댑터 필터 | 워커가 할당된 어댑터만 start |

### E2E 테스트

| 시나리오 | 검증 |
|----------|------|
| 멀티 워커 HTTP 서버 | workers: 2, 실제 HTTP 요청 → 응답 확인 (Linux CI에서만) |
| reusePort 검증 | Worker 스레드 2개, 같은 포트 Bun.serve → 두 워커 모두 요청 수신 확인 |
| 멀티 어댑터 클러스터 | HTTP + 추가 어댑터가 동일 워커에서 모두 부트 확인 |
| Worker Group 격리 | Shared(4) + Exclusive(1) → Exclusive 어댑터는 1회만 실행 |
| 워커 크래시 중 요청 처리 | 한 워커 크래시 시 나머지 워커가 요청 처리 지속 |
| 롤링 리스타트 무중단 | 롤링 중 HTTP 요청 연속 전송 → 503 없음 |
| AOT 빌드 + 클러스터 | `zb build` → `bun dist/entry.js` workers: 2 → 정상 동작 확인 |

---

## 구현 순서

| 순서 | 작업 | 의존성 |
|------|------|--------|
| **Phase 0: 검증** | | |
| 0 | reusePort + Worker 스레드 실동작 검증 테스트 | 없음 |
| **Phase 1: 기반** | | |
| 1 | `enums.ts`: WorkerState enum (Draining 포함), ClusterStrategy enum | 없음 |
| 2 | `errors.ts`: RpcTimeoutError, RpcAbortedError, WorkerStartupTimeoutError | 없음 |
| 3 | `interfaces.ts`: ClusterWorkerSlot (generation, handlers, timers, pendingReplacement 포함), WorkerGroupConfig, GroupCircuitBreaker | 1 |
| 4 | `worker-state.ts`: `transition(slot, from, to)` 함수 + 전이 테이블 + 타이머 자동 해제 | 1, 3 |
| 5 | `rpc-proxy.ts`: wrap() + 타임아웃 + dispose (pending 일괄 reject + 리스너 제거) | 2, 3 |
| 6 | `rpc-expose.ts`: expose() + 화이트리스트 + 에러 직렬화 (stack 포함) | 3 |
| 7 | `rpc-proxy.spec.ts` + `rpc-expose.spec.ts` + `worker-state.spec.ts` | 4, 5, 6 |
| **Phase 2-3: 매니저 코어** | | |
| 8 | `cluster-base-worker.ts`: CPU 통계 수정 (hrtime 기반) | 없음 |
| 9 | `cluster-manager.ts`: 전면 재설계 — 상태 머신, generation, disposeSlot, terminateInitiated, startup 타임아웃, Destroying 타임아웃, 교체 semaphore, 통합 모니터링 루프, 메모리 압박, readiness probe, 이벤트 리스너 정리 | 1-6 |
| 10 | `cluster-manager.ts`: 크래시 복구 — 이벤트 중복 방지, per-worker + per-group circuit breaker, revive AbortController, Reviving 취소 | 9 |
| 11 | `cluster-manager.ts`: 라이프사이클 운영 — drain RPC, graceful shutdown (전 상태 처리), 시그널 핸들링, 롤링 리스타트, 워커 재활용 | 9, 10 |
| 12 | `cluster-manager.spec.ts` (전체 통합 테스트) | 9, 10, 11 |
| **Phase 4-5: 어댑터 통합** | | |
| 13 | `Adapter` 베이스: `clusterStrategy` 프로퍼티 + `drain()` 훅 추가 | 없음 |
| 14 | `HttpAdapter`: drain() 구현 (server.stop + pendingRequests 확인), 클러스터 관련 코드 전체 제거 | 13 |
| 15 | `application-worker.ts`: 어댑터 무관 워커 + 어댑터 필터 + Container 검증 | 8, 9 |
| 16 | `Application`: Worker Group 자동 분류, 클러스터 모드 분기, shutdownCluster(), 시그널 핸들러 | 9, 13, 15 |
| 17 | `CreateApplicationOptions`: `workers`, `cluster` (WorkerGroupConfig[]) 옵션 추가 | 없음 |
| **Phase 6: 정리** | | |
| 18 | `HttpServerOptions.workers` 제거, `http-worker.ts` 삭제, `HttpWorkerRpc` 제거 | 16 |
| **Phase 7-9: 빌드 + 테스트** | | |
| 19 | AOT 컴파일러: `application-worker.ts`를 entrypoints에 추가 | 15 |
| 20 | AOT 컴파일러: `runtime-master.js` 경량 런타임 생성 | 19 |
| 21 | `entry-generator.ts`: 클러스터 모드 분기 | 20 |
| 22 | E2E 테스트: reusePort, Worker Group 격리, 롤링 무중단, SIGTERM, AOT+클러스터 | 전체 |

---

## Phase 9: AOT 빌드 + 클러스터 시너지

AOT 컴파일러 산출물과 클러스터 모드의 상호작용에서 발견된 비효율을 해결한다.

### 9-1. 워커 스크립트가 빌드 산출물에 포함되지 않는 문제

**현재 문제**:

`HttpAdapter.resolveWorkerScript()`가 `http-worker.ts` 소스 경로를 직접 반환한다. 프로덕션 빌드(`dist/`) 실행 시에도 워커는 패키지 소스를 직접 로드:
- 번들링/코드 스플리팅 최적화가 워커에 적용되지 않음
- 워커가 `node_modules` 내 패키지 소스에 의존 — 배포 환경에서 소스가 없으면 실행 불가
- `dist/runtime.js`(번들)와 소스 `.ts`가 혼재하는 불일치

Phase 1-0에서 워커가 `ApplicationWorker`(core 패키지)로 이전되므로, AOT 컴파일러가 이 워커 스크립트를 빌드 산출물에 포함해야 한다.

**해결: AOT 컴파일러가 워커 엔트리포인트를 빌드 산출물에 포함**

`zb build` 시 `dist/`에 워커 스크립트도 번들:

```
dist/
├── entry.js           # 마스터 엔트리
├── runtime.js         # AOT 런타임 (컨테이너, 메타데이터, 핸들러인덱스)
├── worker.js          # ← ApplicationWorker 엔트리 (신규)
├── chunk-*.js         # 공유 청크
└── manifest.json
```

`Bun.build()` 호출 시 `entrypoints`에 워커 스크립트 추가:

```typescript
// build.command.ts 변경
await Bun.build({
  entrypoints: [entryPath, runtimePath, workerPath],  // workerPath 추가
  splitting: true,
  outdir: 'dist',
});
```

코드 스플리팅이 `runtime.js`와 `worker.js` 사이 공통 코드를 `chunk-*.js`로 자동 추출한다.

워커 스크립트 경로 해석은 `Application` 또는 `ClusterManager`가 담당:

```typescript
// Application 또는 ClusterManager 내부
private resolveWorkerScript(): URL {
  if (getRuntimeContext().isAotRuntime === true) {
    const entryDir = Bun.argv[1]?.slice(0, Bun.argv[1].lastIndexOf('/')) ?? '.';
    return new URL(`${entryDir}/worker.js`, 'file://');
  }
  // dev 모드: @zipbul/core의 application-worker.ts 소스 경로
  return new URL('./cluster/application-worker.ts', import.meta.url);
}
```

### 9-2. 워커별 런타임 중복 초기화

**현재 문제**:

각 워커가 `import(manifestPath)` → `runtime.js` 실행 시 독립적으로:
1. `createContainer()` — 모든 프로바이더 팩토리 등록 (~수백 개)
2. `createMetadataRegistry()` — 모든 클래스 메타데이터 Map 생성 + `deepFreeze`
3. `createScopedKeysMap()` — 클래스→키 매핑 Map 생성 + `sealMap`
4. `resolveControllerInstances()` — 컨트롤러 인스턴스 생성 + DI 해결

워커 4개 → 동일한 초기화가 4번 반복. `runtime.js`가 166KB일 때 파싱·실행 오버헤드도 4배.

**분석**:

| 데이터 | 워커 간 동일? | 변경 가능? | 공유 가능? |
|--------|-------------|-----------|-----------|
| Container 팩토리 | 동일 | 불변 (sealMap) | 코드 수준 공유 (각 워커가 실행) |
| 메타데이터 레지스트리 | 동일 | 불변 (deepFreeze + sealMap) | 직렬화 가능하지만 Map/함수 포함 |
| 스코프 키 맵 | 동일 | 불변 (sealMap) | 직렬화 가능하지만 클래스 참조 포함 |
| 핸들러 인덱스 | 동일 | 불변 (as const) | 직렬화 가능 (순수 데이터) |
| 컨트롤러 인스턴스 | 동일 구조, 독립 상태 | 가변 (요청 처리) | **공유 불가** — 각 워커가 독립 인스턴스 필요 |
| 어댑터 설정 | 동일 | 불변 (deepFreeze) | 직렬화 가능 |

**핵심 인사이트**: 컨테이너·메타데이터·인스턴스는 클래스 참조와 클로저를 포함하므로 `postMessage`로 전달할 수 없다 (structured clone 불가). 각 워커가 독립적으로 `runtime.js`를 실행하는 현재 구조가 정당하다.

**최적화 방향**: 중복 초기화를 제거하는 것이 아니라, 초기화 속도를 최소화한다.

1. **워커 스크립트 번들링** (8-1): `runtime.js`와 `worker.js`가 코드 스플리팅으로 공유 청크를 사용하면, Bun의 모듈 캐시가 동일 파일의 반복 파싱을 회피할 수 있다
2. **마스터 프로세스 경량화** (8-3): 마스터가 전체 런타임을 로드하지 않으면 메모리 절약

### 9-3. 마스터 프로세스 불필요한 초기화

**현재 문제**:

클러스터 모드에서 마스터 프로세스의 실행 흐름:
```
entry.js → import runtime.js → registerRuntimeContext(전체 컨텍스트)
         → createApplication() → Application.start()
         → ClusterManager 생성 → 워커에 manifestPath 전달
```

마스터는 전체 `runtime.js`를 실행하여 컨테이너, 메타데이터, 컨트롤러 인스턴스를 모두 생성하지만:
- 어댑터가 요청을 처리하지 않음 (워커가 처리)
- 컨트롤러 인스턴스 사용하지 않음
- 메타데이터 레지스트리 사용하지 않음
- 마스터에 필요한 것: `isAotRuntime`, `manifestPath`, `workers` 설정값뿐

**해결: 마스터 전용 경량 런타임**

AOT 컴파일러가 마스터용 경량 런타임을 별도 생성:

```
dist/
├── entry.js           # 마스터 엔트리 (변경)
├── runtime.js         # 워커용 전체 런타임 (기존)
├── runtime-master.js  # ← 마스터용 경량 런타임 (신규)
├── worker.js          # 워커 엔트리
└── ...
```

`runtime-master.js` 내용 (생성 코드):
```typescript
// 마스터에 필요한 최소 컨텍스트만 등록
import { registerRuntimeContext } from '@zipbul/core';

registerRuntimeContext({
  isAotRuntime: true,
  // container, metadataRegistry, handlerIndex 등 생략
});
```

`entry.js`에서 워커 수에 따라 분기:
```typescript
const workers = config.workers;
const isSingleProcess = workers === undefined || workers === 1;

if (isSingleProcess) {
  await import('./runtime.js');    // 전체 런타임
} else {
  await import('./runtime-master.js');  // 경량 런타임
}

await import('./chunk-app.js');  // createApplication()
```

**효과**:
- 마스터 메모리: `runtime.js` 166KB 파싱·실행 회피
- 마스터 시작 시간: 컨테이너·인스턴스 생성 스킵
- 워커만 전체 런타임 로드

### 9-4. `preload`와 AOT 매니페스트 통합

Phase 4-3에서 `preload` 옵션으로 매니페스트 로드를 결정했다. AOT 빌드와의 통합:

**현재 흐름** (워커):
```
Worker 스크립트 실행 → init RPC 수신 → import(manifestPath) → registerRuntimeContext() → 어댑터 부트
```

**변경 후 흐름**:
```
preload: [runtime.js] → registerRuntimeContext() (자동)
→ Worker 스크립트(ApplicationWorker) 실행 → init RPC 수신 → getRuntimeContext() 즉시 사용 → Application.start() → 모든 어댑터 부트
```

**이점**:
- 동적 `import()` 제거 — 정적 로드 경로로 변환, 더 예측 가능
- init RPC에서 `manifestPath` 전달 불필요 — RPC 페이로드 간소화
- 워커 스크립트가 `manifestPath` 의존성을 가지지 않음 — 관심사 분리
- 어댑터 종류에 무관하게 동일한 워커 초기화 경로

**주의**: `preload`로 로드된 모듈의 사이드 이펙트(`registerRuntimeContext`)가 워커 스크립트 실행 전에 완료됨이 보장되므로 안전하다.

### 9-5. ApplicationWorker의 Container 검증

`ApplicationWorker.init()`에서 `RuntimeContext`가 완전한 컨테이너를 포함하는지 검증해야 한다. AOT 런타임이 `preload`로 로드되었다면 `container`, `handlerIndex`, `adapterConfig` 등이 모두 존재해야 한다. 폴백(`new Container()`)은 에러를 숨기므로 제거하고 즉시 에러를 발생시킨다:

```typescript
// ApplicationWorker.init()
const runtimeCtx = getRuntimeContext();

if (!runtimeCtx.container) {
  throw new Error(
    'AOT runtime context missing container. ' +
    'Ensure runtime module is loaded before worker initialization.'
  );
}
```

---

## 삭제 대상

| 항목 | 이유 |
|------|------|
| `ClusterSlot` 인터페이스 | 미사용. `ClusterWorkerSlot`으로 대체 |
| `ipc.ts` | `rpc-proxy.ts` + `rpc-expose.ts`로 분리 |
| `ipc.spec.ts` | `rpc-proxy.spec.ts` + `rpc-expose.spec.ts`로 분리 |
| `exponential-backoff` 의존성 | 자체 backoff 구현으로 대체 (AbortSignal 통합 필요) |
| `cluster-manager.ts` 내 주석 처리된 코드 | `// worker.remote[releaseProxy]()` 등 |
| `packages/http-adapter/src/http-worker.ts` | `ApplicationWorker`(core)로 대체 |
| `packages/http-adapter/src/http-worker.spec.ts` | 위와 동일 |
| `HttpWorkerRpc` 타입 | 범용 `ApplicationWorkerRpc`로 대체 |
| `HttpServerOptions.workers` | `CreateApplicationOptions.workers`로 이전 |
| `HttpAdapter` 내 `clusterManager`, `resolveWorkerScript()`, `resolveManifestPath()` | `Application`으로 이전 |

---

## 교차검증 결과 반영 사항

이 계획은 12개 기능 간 교차검증을 거쳤으며, 발견된 모든 충돌·경합·누락을 해결한 상태이다.

### 해결된 주요 문제

| 문제 | 해결 | 반영 위치 |
|------|------|-----------|
| 다수 기능이 동시에 같은 워커 교체 시도 | 그룹 단위 교체 semaphore (불변식 B) | Phase 1-6 |
| Destroying 중 close 이벤트 → 불필요한 revive | `terminateInitiated` 플래그 | Phase 1-1, 3-7 |
| 구 워커 이벤트 → 신규 워커에 오귀속 | generation ID (불변식 C) | Phase 1-6 |
| Shutdown이 non-Running 워커 방치 | 전 상태 처리 shutdown 로직 | Phase 6-3 |
| 롤링 리스타트 중 반쯤 생성된 교체 워커 누수 | `pendingReplacement` 추적 | Phase 1-2 |
| Draining 상태 누락 | 상태 머신에 Draining 추가 | Phase 1-1 |
| Destroying 타임아웃 없음 (hang 가능) | 5s terminate 타임아웃 | Phase 3-7 |
| 중복 크래시 이벤트 (error+close) → 이중 카운트 | 크래시 핸들러 멱등성 + generation 검증 | Phase 1-1, 3-1 |
| Startup timeout vs ready race condition | `readyReceived` 플래그 + generation 검증 | Phase 5-5 |
| 헬스체크 + 메모리 폴링 RPC 중복 | 단일 모니터링 루프 통합 | Phase 5-3 |
| Circuit breaker가 롤링 실패 미감지 | 롤링 실패도 crash counter 반영 | Phase 3-6, 6-4 |
| RSS jitter 이중 적용 | 메모리 압박과 리사이클 maxRss 통합 | Phase 5-4, 6-5 |
| Exclusive 어댑터 크래시 시 완전 불능 | 단축 backoff + 관대한 circuit breaker | Phase 6-6 |
| drain 훅 실패 시 동작 미정의 | catch → Destroying 진입 (타임아웃과 동일 처리) | Phase 6-1 |
