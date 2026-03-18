import { Logger } from '@zipbul/logger';

import type { ClusterBaseWorker } from './cluster-base-worker';
import { WorkerState } from './enums';
import { WorkerStartupTimeoutError } from './errors';
import type {
  ClusterOptions,
  ClusterWorkerSlot,
  ClusterWorkerStats,
  GroupCircuitBreaker,
} from './interfaces';
import { wrapWorker } from './rpc-proxy';
import type { ClusterBootstrapParams, ClusterInitParams, RpcCallable } from './types';
import { extractCrashDiagnostics } from './crash-diagnostics';
import { createSlot, disposeSlot, transition } from './worker-state';

const DEFAULT_STARTUP_TIMEOUT_MS = 60_000;
const DEFAULT_RPC_TIMEOUT_MS = 30_000;
const DEFAULT_DESTROY_RPC_TIMEOUT_MS = 5_000;
const DEFAULT_TERMINATE_TIMEOUT_MS = 5_000;
const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 15_000;
const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 5_000;
const DEFAULT_HEALTH_CHECK_MAX_FAILURES = 3;
const DEFAULT_REVIVE_STARTING_DELAY_MS = 300;
const DEFAULT_REVIVE_MAX_DELAY_MS = 30_000;
const DEFAULT_CRASH_WINDOW_MS = 60_000;
const DEFAULT_MAX_CRASHES_IN_WINDOW = 5;
const RPC_METHODS: ReadonlyArray<string> = ['init', 'bootstrap', 'destroy', 'getStats'];

interface ClusterManagerConfig {
  readonly startupTimeoutMs?: number;
  readonly rpcTimeoutMs?: number;
  readonly terminateTimeoutMs?: number;
  readonly healthCheckIntervalMs?: number;
  readonly healthCheckTimeoutMs?: number;
  readonly healthCheckMaxFailures?: number;
  readonly reviveStartingDelayMs?: number;
  readonly reviveMaxDelayMs?: number;
  readonly crashWindowMs?: number;
  readonly maxCrashesInWindow?: number;
  readonly smol?: boolean;
  readonly preload?: readonly string[];
  /** Adapter class names for this worker group. Passed to workers via init RPC params. */
  readonly adapterFilter?: readonly string[];
  /** Memory limit per worker in bytes. Required for memory pressure monitoring. */
  readonly memoryLimitBytes?: number;
  /** Soft memory threshold (0-1). Default 0.8. Triggers graceful recycle. */
  readonly memorySoftThreshold?: number;
  /** Hard memory threshold (0-1). Default 0.95. Triggers immediate crash treatment. */
  readonly memoryHardThreshold?: number;
}

/**
 * Manages a group of Worker threads with lifecycle state machine,
 * crash recovery, health monitoring, and graceful shutdown.
 *
 * Each ClusterManager instance manages one WorkerGroup.
 * The Application creates one ClusterManager per group.
 *
 * @public
 */
export class ClusterManager<T extends ClusterBaseWorker & Record<string, RpcCallable>> {
  private readonly script: URL;
  private readonly slots: Array<ClusterWorkerSlot<T>>;
  private readonly logger = new Logger(ClusterManager.name);
  private readonly reviveControllers = new Map<number, AbortController>();
  private readonly config: Required<Omit<ClusterManagerConfig, 'adapterFilter' | 'memoryLimitBytes'>>
    & { readonly adapterFilter: readonly string[] | undefined; readonly memoryLimitBytes: number | undefined };
  private readonly circuitBreaker: GroupCircuitBreaker;

  destroying = false;
  replacementInProgress = false;
  rollingRestartInProgress = false;

  private initialized = false;
  private initParams: ClusterInitParams<T> | undefined;
  private bootstrapParams: ClusterBootstrapParams<T>;
  private healthCheckTimer: ReturnType<typeof setInterval> | undefined;
  private recoveryTimer: ReturnType<typeof setInterval> | undefined;

  constructor(options: ClusterOptions, config?: ClusterManagerConfig) {
    const size = options.size ?? navigator.hardwareConcurrency;

    if (!options.script || options.script.protocol !== 'file:') {
      throw new Error(`ClusterManager requires a valid file:// script URL, got: ${String(options.script)}`);
    }

    this.script = options.script;
    this.config = {
      startupTimeoutMs: config?.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
      rpcTimeoutMs: config?.rpcTimeoutMs ?? DEFAULT_RPC_TIMEOUT_MS,
      terminateTimeoutMs: config?.terminateTimeoutMs ?? DEFAULT_TERMINATE_TIMEOUT_MS,
      healthCheckIntervalMs: config?.healthCheckIntervalMs ?? DEFAULT_HEALTH_CHECK_INTERVAL_MS,
      healthCheckTimeoutMs: config?.healthCheckTimeoutMs ?? DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
      healthCheckMaxFailures: config?.healthCheckMaxFailures ?? DEFAULT_HEALTH_CHECK_MAX_FAILURES,
      reviveStartingDelayMs: config?.reviveStartingDelayMs ?? DEFAULT_REVIVE_STARTING_DELAY_MS,
      reviveMaxDelayMs: config?.reviveMaxDelayMs ?? DEFAULT_REVIVE_MAX_DELAY_MS,
      crashWindowMs: config?.crashWindowMs ?? DEFAULT_CRASH_WINDOW_MS,
      maxCrashesInWindow: config?.maxCrashesInWindow ?? DEFAULT_MAX_CRASHES_IN_WINDOW,
      smol: config?.smol ?? false,
      preload: config?.preload ?? [],
      adapterFilter: config?.adapterFilter,
      memoryLimitBytes: config?.memoryLimitBytes,
      memorySoftThreshold: config?.memorySoftThreshold ?? 0.8,
      memoryHardThreshold: config?.memoryHardThreshold ?? 0.95,
    };

    // Validate memory thresholds
    if (this.config.memoryLimitBytes !== undefined) {
      if (this.config.memorySoftThreshold >= this.config.memoryHardThreshold) {
        throw new Error(
          `memorySoftThreshold (${this.config.memorySoftThreshold}) must be less than memoryHardThreshold (${this.config.memoryHardThreshold})`,
        );
      }

      if (this.config.memorySoftThreshold <= 0 || this.config.memorySoftThreshold > 1) {
        throw new Error(`memorySoftThreshold must be in (0, 1], got ${this.config.memorySoftThreshold}`);
      }

      if (this.config.memoryHardThreshold <= 0 || this.config.memoryHardThreshold > 1) {
        throw new Error(`memoryHardThreshold must be in (0, 1], got ${this.config.memoryHardThreshold}`);
      }
    }

    this.circuitBreaker = {
      crashTimestamps: [],
      maxIntensity: this.config.maxCrashesInWindow,
      periodMs: this.config.crashWindowMs,
      tripped: false,
    };

    // Lazy init: create slot objects only, no workers spawned yet
    this.slots = Array.from({ length: size }, (_, id) => createSlot<T>(id));
  }

  // ── Lifecycle ──────────────────────────────────────────────

  /**
   * Spawns all workers, sends init RPC, and waits for all to reach Running.
   *
   * @param params - Init parameters forwarded to each worker's init() method.
   * @public
   */
  async init(params?: ClusterInitParams<T>): Promise<void> {
    if (this.initialized) {
      throw new Error('init() has already been called. ClusterManager does not support re-initialization.');
    }

    this.initialized = true;
    this.initParams = params;

    const tasks = this.slots.map(async (slot) => {
      this.spawnWorker(slot);
      await this.waitForInit(slot, params);
    });

    await Promise.all(tasks);
  }

  /**
   * Sends bootstrap RPC to all Running workers.
   *
   * @param params - Bootstrap parameters forwarded to each worker.
   * @public
   */
  async bootstrap(params?: ClusterBootstrapParams<T>): Promise<void> {
    if (!this.initialized) {
      throw new Error('bootstrap() cannot be called before init().');
    }

    this.bootstrapParams = params;

    const tasks = this.slots.map(async (slot) => {
      if (!slot.remote) {
        return;
      }

      await slot.remote.bootstrap(params);
    });

    await Promise.all(tasks);
  }

  /**
   * Starts the periodic health check / monitoring loop.
   *
   * @public
   */
  startHealthCheck(): void {
    if (this.healthCheckTimer !== undefined) {
      return;
    }

    this.healthCheckTimer = setInterval(() => {
      void this.monitorWorkers();
    }, this.config.healthCheckIntervalMs);
  }

  /**
   * Stops health checks and gracefully shuts down all workers.
   *
   * Sequence:
   * 1. Cancel all revive operations
   * 2. Terminate non-Running workers immediately
   * 3. Terminate Running workers (with destroy RPC attempt)
   * 4. Force-terminate any remaining after timeout
   *
   * @public
   */
  async destroy(): Promise<void> {
    this.destroying = true;

    if (this.healthCheckTimer !== undefined) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }

    if (this.recoveryTimer !== undefined) {
      clearInterval(this.recoveryTimer);
      this.recoveryTimer = undefined;
    }

    this.cancelAllRevives();

    await Promise.all(this.slots.map(async (slot) => this.terminateWorker(slot)));
  }

  // ── Worker Spawning ────────────────────────────────────────

  private spawnWorker(slot: ClusterWorkerSlot<T>): void {
    const native = new Worker(this.script.href, {
      smol: this.config.smol,
      preload: [...this.config.preload],
    });

    slot.native = native;
    slot.terminateInitiated = false;
    slot.readyReceived = false;

    // Set per-slot memory limits with jitter to prevent thundering herd
    if (this.config.memoryLimitBytes !== undefined && this.config.memoryLimitBytes > 0) {
      const jitter = 0.95 + Math.random() * 0.1; // 0.95 ~ 1.05
      slot.hardMemoryLimit = Math.round(this.config.memoryLimitBytes * this.config.memoryHardThreshold * jitter);
      slot.softMemoryLimit = Math.round(this.config.memoryLimitBytes * this.config.memorySoftThreshold * jitter);
    }

    const gen = slot.generation;

    // Register event handlers with generation guard (Invariant C)
    const onOpen = () => {
      if (slot.generation !== gen) return;
      if (slot.state === WorkerState.Spawning) {
        transition(slot, WorkerState.Spawning, WorkerState.Ready);
        slot.lastReadyTime = Date.now();
      }
    };

    const onError = (event: ErrorEvent) => {
      if (slot.generation !== gen) return;
      this.handleCrash('error', slot, event);
    };

    const onMessageError = (event: MessageEvent) => {
      if (slot.generation !== gen) return;
      this.handleCrash('messageerror', slot, event);
    };

    const onClose = (event: CloseEvent) => {
      if (slot.generation !== gen) return;

      if (slot.state === WorkerState.Destroying && slot.terminateInitiated) {
        // Expected close after terminate() — transition to Terminated
        transition(slot, WorkerState.Destroying, WorkerState.Terminated);
        disposeSlot(slot);
      } else {
        this.handleCrash('close', slot, event);
      }
    };

    native.addEventListener('open', onOpen);
    native.addEventListener('error', onError);
    native.addEventListener('messageerror', onMessageError);
    native.addEventListener('close', onClose);

    slot.handlers.set('open', onOpen as EventListener);
    slot.handlers.set('error', onError as EventListener);
    slot.handlers.set('messageerror', onMessageError as EventListener);
    slot.handlers.set('close', onClose as EventListener);

    // Create RPC proxy with timeout + dispose
    const rpcProxy = wrapWorker<T>(native, RPC_METHODS as ReadonlyArray<keyof T>, this.config.rpcTimeoutMs);
    slot.rpcProxy = rpcProxy;
    slot.remote = rpcProxy.api;
  }

  private async waitForInit(slot: ClusterWorkerSlot<T>, params: ClusterInitParams<T>): Promise<void> {
    if (!slot.remote) {
      throw new Error(`Worker #${slot.id} has no RPC proxy`);
    }

    // Startup timeout
    const startupPromise = (async () => {
      // Wait for open event if still in Spawning state
      if (slot.state === WorkerState.Spawning) {
        await this.waitForOpen(slot);
      }

      transition(slot, WorkerState.Ready, WorkerState.Initializing);
      await slot.remote!.init(slot.id, params, this.config.adapterFilter);
      await slot.remote!.bootstrap(this.bootstrapParams);

      slot.readyReceived = true;
      transition(slot, WorkerState.Initializing, WorkerState.Running);
    })();

    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        if (slot.readyReceived) return;
        reject(new WorkerStartupTimeoutError(slot.id, this.config.startupTimeoutMs));
      }, this.config.startupTimeoutMs);

      slot.startupTimer = timer;
      slot.timers.add(timer);
    });

    try {
      await Promise.race([startupPromise, timeoutPromise]);
    } catch (error) {
      if (!slot.readyReceived) {
        this.handleCrash('startup-timeout', slot, error instanceof Error ? error : new Error(String(error)));
      }

      throw error;
    }
  }

  private waitForOpen(slot: ClusterWorkerSlot<T>): Promise<void> {
    if (slot.state !== WorkerState.Spawning) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const gen = slot.generation;

      const check = () => {
        if (slot.generation !== gen) {
          reject(new Error('Worker generation changed while waiting for open'));
          return;
        }

        if (slot.state !== WorkerState.Spawning) {
          resolve();
          return;
        }

        // Polling timers are intentionally NOT tracked in slot.timers.
        // They are short-lived (10ms) and self-terminate when state changes.
        // Adding them to slot.timers would cause clearSlotTimers() during
        // Spawning→Ready transition to cancel the very check that detects the transition.
        setTimeout(check, 10);
      };

      check();
    });
  }

  // ── Crash Handling ─────────────────────────────────────────

  private handleCrash(event: string, slot: ClusterWorkerSlot<T>, error: Error | Event): void {
    // Skip if already in a non-crashable state
    if (
      slot.state === WorkerState.Crashed ||
      slot.state === WorkerState.Reviving ||
      slot.state === WorkerState.Destroying ||
      slot.state === WorkerState.Terminated
    ) {
      return;
    }

    // Invariant A: central transition function
    const transitioned = transition(slot, slot.state, WorkerState.Crashed);

    if (!transitioned) {
      return;
    }

    // Invariant C: increment generation on Crashed entry
    slot.generation++;
    slot.lastCrashTime = Date.now();

    const diagnostics = extractCrashDiagnostics(error);
    this.logger.error(`Worker #${slot.id} [gen=${slot.generation - 1}] ${event}`, diagnostics);

    // Clean up resources — capture native ref before dispose nulls it
    const native = slot.native;
    disposeSlot(slot);

    // Terminate native thread if still alive.
    // Skip for 'close' events — Worker is already dead, terminate() would be invalid.
    if (native && event !== 'close') {
      native.unref();
      native.terminate();
    }

    // Record crash for group circuit breaker
    if (!this.recordGroupCrash()) {
      // Circuit breaker tripped — no revive.
      // During destroy, ensure slot reaches Terminated (not stuck in Crashed).
      if (this.destroying) {
        transition(slot, WorkerState.Crashed, WorkerState.Terminated);
      }

      return;
    }

    // Per-worker circuit breaker
    if (!this.shouldRevive(slot)) {
      transition(slot, WorkerState.Crashed, WorkerState.Terminated);
      return;
    }

    this.reviveWorker(slot);
  }

  private shouldRevive(slot: ClusterWorkerSlot<T>): boolean {
    if (this.destroying) {
      return false;
    }

    slot.reviveAttempts++;

    if (slot.firstCrashTime === undefined) {
      slot.firstCrashTime = Date.now();
    }

    if (slot.reviveAttempts >= this.config.maxCrashesInWindow) {
      const timeSinceFirst = Date.now() - slot.firstCrashTime;

      if (timeSinceFirst < this.config.crashWindowMs) {
        this.logger.error(
          `Worker #${slot.id} crashed ${slot.reviveAttempts} times in ${timeSinceFirst}ms — giving up`,
        );

        return false;
      }

      // Outside window — reset counter
      slot.reviveAttempts = 1;
      slot.firstCrashTime = Date.now();
    }

    return true;
  }

  private recordGroupCrash(): boolean {
    if (this.circuitBreaker.tripped) {
      return false;
    }

    const now = Date.now();
    this.circuitBreaker.crashTimestamps.push(now);

    // Trim to window
    this.circuitBreaker.crashTimestamps = this.circuitBreaker.crashTimestamps.filter(
      (timestamp) => now - timestamp < this.circuitBreaker.periodMs,
    );

    if (this.circuitBreaker.crashTimestamps.length >= this.circuitBreaker.maxIntensity) {
      this.circuitBreaker.tripped = true;

      this.logger.error(
        `Group circuit breaker tripped: ${this.circuitBreaker.crashTimestamps.length} crashes in ${this.circuitBreaker.periodMs}ms`,
      );

      // Cancel all reviving workers
      for (const slot of this.slots) {
        if (slot.state === WorkerState.Reviving) {
          this.cancelRevive(slot);
          transition(slot, WorkerState.Reviving, WorkerState.Terminated);
        }
      }

      this.startRecoveryTimer();

      return false;
    }

    return true;
  }

  private startRecoveryTimer(): void {
    if (this.recoveryTimer !== undefined) return;

    this.recoveryTimer = setInterval(() => {
      if (this.destroying) {
        clearInterval(this.recoveryTimer!);
        this.recoveryTimer = undefined;

        return;
      }

      const now = Date.now();
      const recentCrashes = this.circuitBreaker.crashTimestamps.filter(
        (timestamp) => now - timestamp < this.circuitBreaker.periodMs,
      );

      if (recentCrashes.length > 0) return; // Still within crash window

      clearInterval(this.recoveryTimer!);
      this.recoveryTimer = undefined;
      this.circuitBreaker.tripped = false;
      this.circuitBreaker.crashTimestamps = [];

      this.logger.info('Circuit breaker recovered — restarting terminated workers');

      // Cannot recover if init() was never called
      if (!this.initialized) {
        this.logger.warn('Cannot recover workers — init() was never called');

        return;
      }

      // Restart terminated/crashed workers with fresh slots
      for (let slotIndex = 0; slotIndex < this.slots.length; slotIndex++) {
        const slot = this.slots[slotIndex]!;

        if (
          (slot.state === WorkerState.Terminated || slot.state === WorkerState.Crashed) &&
          !this.destroying
        ) {
          const freshSlot = createSlot<T>(slot.id);
          this.slots[slotIndex] = freshSlot;
          this.spawnWorker(freshSlot);

          void this.waitForInit(freshSlot, this.initParams).catch((error) => {
            this.handleCrash(
              'recovery-failed',
              freshSlot,
              error instanceof Error ? error : new Error(String(error)),
            );
          });
        }
      }
    }, this.config.crashWindowMs);
  }

  // ── Revive ─────────────────────────────────────────────────

  private reviveWorker(slot: ClusterWorkerSlot<T>): void {
    if (this.destroying || this.reviveControllers.has(slot.id)) {
      return;
    }

    transition(slot, WorkerState.Crashed, WorkerState.Reviving);

    const controller = new AbortController();
    this.reviveControllers.set(slot.id, controller);

    void this.reviveLoop(slot, controller.signal);
  }

  private async reviveLoop(slot: ClusterWorkerSlot<T>, signal: AbortSignal): Promise<void> {
    let delay = this.config.reviveStartingDelayMs;

    try {
      while (!signal.aborted && !this.destroying) {
        // Wait with jittered delay
        const jitteredDelay = Math.round(delay * (0.5 + Math.random() * 0.5));

        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, jitteredDelay);
          slot.timers.add(timer);

          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Revive aborted'));
          }, { once: true });
        });

        if (signal.aborted || this.destroying) break;

        this.logger.info(`Revive attempt for worker #${slot.id}`);

        try {
          // Transition back to Spawning for respawn
          const spawning = transition(slot, WorkerState.Reviving, WorkerState.Spawning);

          if (!spawning) break; // Slot was terminated during shutdown
          this.spawnWorker(slot);
          await this.waitForInit(slot, this.initParams);

          // Success — worker is Running
          this.reviveControllers.delete(slot.id);

          return;
        } catch {
          // init failed — back to Crashed for retry
          if (slot.state !== WorkerState.Crashed && slot.state !== WorkerState.Terminated) {
            const transitioned = transition(slot, slot.state, WorkerState.Crashed);

            if (transitioned) {
              slot.generation++;
              disposeSlot(slot);
            }
          }

          // Check circuit breaker
          if (!this.recordGroupCrash() || !this.shouldRevive(slot)) {
            transition(slot, WorkerState.Crashed, WorkerState.Terminated);
            break;
          }

          transition(slot, WorkerState.Crashed, WorkerState.Reviving);
        }

        // Exponential backoff
        delay = Math.min(delay * 2, this.config.reviveMaxDelayMs);
      }
    } catch {
      // Aborted
    } finally {
      this.reviveControllers.delete(slot.id);
    }
  }

  private cancelRevive(slot: ClusterWorkerSlot<T>): void {
    const controller = this.reviveControllers.get(slot.id);

    if (controller) {
      controller.abort();
      this.reviveControllers.delete(slot.id);
    }
  }

  private cancelAllRevives(): void {
    for (const [id, controller] of this.reviveControllers) {
      controller.abort();
      const slot = this.slots[id];

      if (slot && slot.state === WorkerState.Reviving) {
        const native = slot.native;
        transition(slot, WorkerState.Reviving, WorkerState.Terminated);
        disposeSlot(slot);

        if (native) {
          native.unref();
          native.terminate();
        }
      }
    }

    this.reviveControllers.clear();
  }

  // ── Terminate ──────────────────────────────────────────────

  private async terminateWorker(slot: ClusterWorkerSlot<T>): Promise<void> {
    if (slot.state === WorkerState.Terminated) {
      return;
    }

    // For non-Running/non-Draining states, go directly to Terminated
    if (
      slot.state === WorkerState.Spawning ||
      slot.state === WorkerState.Ready ||
      slot.state === WorkerState.Initializing ||
      slot.state === WorkerState.Crashed ||
      slot.state === WorkerState.Reviving
    ) {
      this.cancelRevive(slot);
      const native = slot.native;
      transition(slot, slot.state, WorkerState.Terminated);
      disposeSlot(slot);

      if (native) {
        native.unref();
        native.terminate();
      }

      return;
    }

    // Running → Draining: attempt drain RPC to let worker finish in-flight work
    slot.terminateInitiated = true;

    if (slot.state === WorkerState.Running) {
      transition(slot, WorkerState.Running, WorkerState.Draining);

      // Send drain RPC so the worker's adapters can stop accepting connections
      if (slot.remote) {
        const destroyTimeout = this.timeoutWithCleanup(DEFAULT_DESTROY_RPC_TIMEOUT_MS);

        try {
          await Promise.race([
            slot.remote.destroy(), // worker-side drain + cleanup
            destroyTimeout.promise,
          ]);
        } catch {
          // Drain failed — proceed to force terminate
        } finally {
          destroyTimeout.clear();
        }
      }
    }

    if (slot.state === WorkerState.Draining) {
      transition(slot, WorkerState.Draining, WorkerState.Destroying);
    }

    // Dispose RPC (rejects any remaining pending)
    slot.rpcProxy?.dispose();

    // Force terminate
    if (slot.native) {
      slot.native.unref();
      slot.native.terminate();
    }

    // Wait for Terminated state (via close event or timeout)
    await new Promise<void>((resolve) => {
      if (slot.state === WorkerState.Terminated) {
        resolve();
        return;
      }

      const terminateTimer = setTimeout(() => {
        if (slot.state === WorkerState.Destroying) {
          transition(slot, WorkerState.Destroying, WorkerState.Terminated);
          disposeSlot(slot);
        }

        resolve();
      }, this.config.terminateTimeoutMs);

      slot.timers.add(terminateTimer);

      // Also resolve on close event (which transitions to Terminated)
      if (slot.native) {
        const gen = slot.generation;
        const terminateCloseHandler = () => {
          if (slot.generation !== gen) return;
          clearTimeout(terminateTimer);
          resolve();
        };

        slot.native.addEventListener('close', terminateCloseHandler, { once: true });
        slot.handlers.set('terminate-close', terminateCloseHandler as EventListener);
      }
    });
  }

  // ── Health Monitoring ──────────────────────────────────────

  private async monitorWorkers(): Promise<void> {
    if (this.destroying) return;

    const tasks = this.slots
      .filter((slot) => slot.state === WorkerState.Running)
      .map(async (slot) => this.checkWorkerHealth(slot));

    await Promise.all(tasks);
  }

  private async checkWorkerHealth(slot: ClusterWorkerSlot<T>): Promise<void> {
    if (!slot.remote || slot.state !== WorkerState.Running) return;

    if (slot.healthCheckPending) {
      // Previous check still in-flight — skip (back-pressure)
      return;
    }

    slot.healthCheckPending = true;
    const healthTimeout = this.timeoutWithCleanup(this.config.healthCheckTimeoutMs);

    try {
      const stats = await Promise.race([
        slot.remote.getStats() as Promise<ClusterWorkerStats>,
        healthTimeout.promise,
      ]);

      slot.healthCheckPending = false;
      slot.healthCheckFailures = 0;
      slot.lastStats = stats as ClusterWorkerStats;

      // Memory pressure evaluation (integrated with health check)
      this.evaluateMemoryPressure(slot, stats as ClusterWorkerStats);
    } catch {
      slot.healthCheckPending = false;

      // Re-check state — worker may have transitioned during await
      if (slot.state !== WorkerState.Running) return;

      slot.healthCheckFailures++;

      if (slot.healthCheckFailures >= this.config.healthCheckMaxFailures) {
        this.logger.error(`Worker #${slot.id} health check failed ${slot.healthCheckFailures} times — marking crashed`);
        this.handleCrash('healthcheck', slot, new Error('Health check timeout'));
      }
    } finally {
      healthTimeout.clear();
    }
  }

  // ── Memory Pressure ────────────────────────────────────────

  private evaluateMemoryPressure(slot: ClusterWorkerSlot<T>, stats: ClusterWorkerStats): void {
    const limitBytes = this.config.memoryLimitBytes;

    if (limitBytes === undefined || limitBytes <= 0) {
      return; // Memory monitoring disabled
    }

    if (slot.hardMemoryLimit <= 0 || slot.softMemoryLimit <= 0) {
      return; // Slot limits not yet set or rounded to zero from pathological config
    }

    if (stats.memory >= slot.hardMemoryLimit) {
      this.logger.error(`Worker #${slot.id} hard memory limit: ${stats.memory}/${slot.hardMemoryLimit} bytes`);
      this.handleCrash('memory-hard', slot, new Error(`RSS ${stats.memory} exceeds hard limit ${slot.hardMemoryLimit}`));

      return;
    }

    if (stats.memory >= slot.softMemoryLimit && !this.replacementInProgress) {
      this.logger.warn(`Worker #${slot.id} soft memory limit: ${stats.memory}/${slot.softMemoryLimit} bytes — recycling`);
      void this.recycleWorker(slot);
    }
  }

  // ── Rolling Restart ───────────────────────────────────────

  /**
   * Replaces all workers in this group one-by-one.
   * Shared groups: spawn new → ready → drain old → terminate old (zero-downtime).
   * Exclusive groups: drain old → terminate old → spawn new → ready (no overlap).
   *
   * @public
   */
  async rollingRestart(): Promise<void> {
    if (this.rollingRestartInProgress) {
      throw new Error('Rolling restart already in progress');
    }

    this.rollingRestartInProgress = true;
    let consecutiveFailures = 0;

    try {
      for (const slot of this.slots) {
        if (this.destroying) break;

        if (slot.state !== WorkerState.Running) continue;

        // Acquire replacement lock
        if (this.replacementInProgress) continue;
        this.replacementInProgress = true;

        try {
          await this.replaceWorker(slot);
          consecutiveFailures = 0;
        } catch {
          consecutiveFailures++;

          if (!this.recordGroupCrash()) {
            break; // Circuit breaker tripped — abort rolling restart
          }

          if (consecutiveFailures >= 2) {
            this.logger.error(`Rolling restart aborted: ${consecutiveFailures} consecutive failures`);
            break;
          }
        } finally {
          this.replacementInProgress = false;
        }
      }
    } finally {
      this.rollingRestartInProgress = false;
    }
  }

  // ── Worker Recycling ──────────────────────────────────────

  private async recycleWorker(slot: ClusterWorkerSlot<T>): Promise<void> {
    if (this.replacementInProgress || this.destroying) return;

    this.replacementInProgress = true;

    try {
      await this.replaceWorker(slot);
    } catch (error) {
      this.logger.error(`Worker #${slot.id} recycle failed`, error instanceof Error ? error : undefined);
    } finally {
      this.replacementInProgress = false;
    }
  }

  /**
   * Replaces a single Running worker with a new one.
   * Shared: spawn new first (zero-downtime), then drain old.
   * This is the primitive used by both rolling restart and recycling.
   */
  private async replaceWorker(slot: ClusterWorkerSlot<T>): Promise<void> {
    if (slot.state !== WorkerState.Running) return;

    const slotIndex = this.slots.indexOf(slot);

    if (slotIndex === -1) return;

    // Spawn replacement worker in a temporary slot
    const tempSlot = createSlot<T>(slot.id);
    this.spawnWorker(tempSlot);

    try {
      await this.waitForInit(tempSlot, this.initParams);
    } catch {
      // New worker failed — terminate it, keep old worker
      if (tempSlot.native) {
        tempSlot.native.terminate();
      }

      disposeSlot(tempSlot);
      throw new Error(`Replacement worker #${slot.id} failed to start`);
    }

    // New worker is Running — drain and terminate old worker
    await this.terminateWorker(slot);

    // Promote: replace slot in the array with the tempSlot.
    // tempSlot has gone through the full transition chain
    // (Spawning→Ready→Initializing→Running) and has its own
    // event handlers and RPC proxy. No manual field copying needed.
    this.slots[slotIndex] = tempSlot;
  }

  // ── Utilities ──────────────────────────────────────────────

  private timeoutWithCleanup(ms: number): { promise: Promise<never>; clear: () => void } {
    let timer: ReturnType<typeof setTimeout>;
    const promise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    });

    return { promise, clear: () => clearTimeout(timer!) };
  }

  /**
   * Returns a snapshot of all slot states for external inspection.
   *
   * @returns Array of slot state summaries.
   * @public
   */
  getSlotStates(): ReadonlyArray<{ id: number; state: WorkerState; generation: number }> {
    return this.slots.map((slot) => ({
      id: slot.id,
      state: slot.state,
      generation: slot.generation,
    }));
  }

  /** @internal Exposed for integration test access to slot internals. */
  readonly __testing__ = {
    getSlots: (): ReadonlyArray<ClusterWorkerSlot<T>> => this.slots,
  };
}
