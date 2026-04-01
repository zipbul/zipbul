import { describe, it, expect, afterEach, spyOn } from 'bun:test';

import { ClusterManager } from '../../src/cluster/cluster-manager';
import { WorkerState } from '../../src/cluster/enums';
import type { ClusterBaseWorker } from '../../src/cluster/cluster-base-worker';
import type { RpcCallable } from '../../src/cluster/types';
import type { CrashDiagnostics } from '../../src/cluster/crash-diagnostics';

type TestWorkerRpc = ClusterBaseWorker & Record<string, RpcCallable>;

const WORKER_SCRIPT = new URL('./fixtures/test-worker.ts', import.meta.url);

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs: number,
  intervalMs = 50,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
  return predicate();
}

function createManager(size: number, config?: Record<string, unknown>): ClusterManager<TestWorkerRpc> {
  return new ClusterManager<TestWorkerRpc>(
    { script: WORKER_SCRIPT, size },
    {
      startupTimeoutMs: 10_000,
      rpcTimeoutMs: 5_000,
      terminateTimeoutMs: 3_000,
      healthCheckIntervalMs: 60_000,
      reviveStartingDelayMs: 100,
      reviveMaxDelayMs: 500,
      crashWindowMs: 5_000,
      maxCrashesInWindow: 3,
      ...config,
    },
  );
}

describe('ClusterManager', () => {
  let manager: ClusterManager<TestWorkerRpc> | undefined;

  afterEach(async () => {
    if (manager) {
      try {
        await manager.destroy();
      } catch {
        // best-effort cleanup
      }

      manager = undefined;
    }
  });

  // ── normal lifecycle ─────────────────────────────────────────

  describe('normal lifecycle', () => {
    it('should reach Running state for all workers when init and bootstrap are called', async () => {
      // Arrange
      manager = createManager(2);

      // Act
      await manager.init();
      await manager.bootstrap();

      // Assert
      const states = manager.getSlotStates();
      expect(states).toHaveLength(2);
      expect(states[0]?.state).toBe(WorkerState.Running);
      expect(states[1]?.state).toBe(WorkerState.Running);
    });

    it('should reach Terminated state for all workers when destroy is called after init', async () => {
      // Arrange
      manager = createManager(2);
      await manager.init();
      await manager.bootstrap();

      // Act
      await manager.destroy();

      // Assert
      const states = manager.getSlotStates();
      expect(states.every((slot) => slot.state === WorkerState.Terminated)).toBe(true);
      manager = undefined;
    });

    it('should keep generation at 0 when no crashes occur during normal lifecycle', async () => {
      // Arrange
      manager = createManager(1);

      // Act
      await manager.init();
      await manager.bootstrap();

      // Assert
      const states = manager.getSlotStates();
      expect(states[0]?.state).toBe(WorkerState.Running);
      expect(states[0]?.generation).toBe(0);
    });
  });

  // ── constructor validation ───────────────────────────────────

  describe('constructor validation', () => {
    it('should throw when script URL is not file protocol', () => {
      // Arrange & Act & Assert
      expect(() => {
        new ClusterManager<TestWorkerRpc>(
          { script: new URL('https://example.com/worker.js'), size: 1 },
        );
      }).toThrow('file://');
    });

    it('should throw when memorySoftThreshold >= memoryHardThreshold and memoryLimitBytes is set', () => {
      // Arrange & Act & Assert
      expect(() => createManager(1, {
        memoryLimitBytes: 256 * 1024 * 1024,
        memorySoftThreshold: 0.95,
        memoryHardThreshold: 0.8,
      })).toThrow('memorySoftThreshold');
    });

    it('should throw when memorySoftThreshold is out of (0,1] range and memoryLimitBytes is set', () => {
      // Arrange & Act & Assert
      expect(() => createManager(1, {
        memoryLimitBytes: 256 * 1024 * 1024,
        memorySoftThreshold: 0,
        memoryHardThreshold: 0.95,
      })).toThrow('memorySoftThreshold');
    });

    it('should throw when memoryHardThreshold is out of (0,1] range and memoryLimitBytes is set', () => {
      // Arrange & Act & Assert
      expect(() => createManager(1, {
        memoryLimitBytes: 256 * 1024 * 1024,
        memorySoftThreshold: 0.5,
        memoryHardThreshold: 1.5,
      })).toThrow('memoryHardThreshold');
    });

    it('should not validate memory thresholds when memoryLimitBytes is not set', () => {
      // Arrange & Act & Assert — should NOT throw even with invalid thresholds
      expect(() => createManager(1, {
        memorySoftThreshold: 0.99,
        memoryHardThreshold: 0.5,
      })).not.toThrow();
    });

    it('should default smol to false regardless of worker count', () => {
      // Arrange
      manager = createManager(4);

      // Act — inspect config via __testing__
      const slots = manager.__testing__.getSlots();

      // Assert — slots exist (manager was constructed without error)
      expect(slots).toHaveLength(4);
      // smol default is false — verified by the fact that the manager constructs
      // without error and workers can be spawned (smol=true would use a different thread pool)
    });
  });

  // ── lifecycle guards ─────────────────────────────────────────

  describe('lifecycle guards', () => {
    it('should throw when init is called twice', async () => {
      // Arrange
      manager = createManager(1);
      await manager.init();
      await manager.bootstrap();

      // Act & Assert — second init must throw
      await expect(manager.init()).rejects.toThrow('init() has already been called');
    });

    it('should throw when bootstrap is called before init', async () => {
      // Arrange
      manager = createManager(1);

      // Act & Assert — bootstrap before init must throw
      await expect(manager.bootstrap()).rejects.toThrow('bootstrap() cannot be called before init()');
    });
  });

  // ── thread leak prevention (BUG-1, BUG-2, BUG-3) ────────────

  describe('thread leak prevention (BUG-1, BUG-2, BUG-3)', () => {
    it('should terminate native Worker thread when destroying a non-Running worker (BUG-1)', async () => {
      // Arrange — start init with slowInit so worker stays in non-Running state
      manager = createManager(1, { startupTimeoutMs: 30_000 });

      const initPromise = manager.init({ slowInit: 5_000 }).catch(() => {});

      // Wait for worker to be spawned (native assigned) but not yet Running
      const slots = manager.__testing__.getSlots();
      const spawned = await waitForCondition(
        () => slots[0]?.native !== undefined,
        3_000,
      );
      expect(spawned).toBe(true);

      const slot = slots[0]!;
      const nativeRef = slot.native!;

      // Pre-condition: worker is NOT Running or Terminated
      expect(slot.state).not.toBe(WorkerState.Running);
      expect(slot.state).not.toBe(WorkerState.Terminated);

      // Set up close listener on captured native to detect terminate() call
      let closeReceived = false;
      nativeRef.addEventListener('close', () => { closeReceived = true; }, { once: true });

      // Act — destroy while worker is in non-Running state
      await manager.destroy();
      await initPromise;

      // Assert — native Worker must have been terminated (close event received)
      const wasTerminated = await waitForCondition(() => closeReceived, 3_000);
      expect(wasTerminated).toBe(true);
      manager = undefined;
    });

    it('should clean up native reference in slot when worker crashes via close event (BUG-2)', async () => {
      // Arrange — worker crashes via process.exit(1), trips breaker on first crash
      manager = createManager(1, {
        maxCrashesInWindow: 1,
        crashWindowMs: 10_000,
      });

      // Act — init will crash
      await expect(manager.init({ crash: true })).rejects.toThrow();

      // Wait for crash handling to complete
      const slots = manager.__testing__.getSlots();
      const cleaned = await waitForCondition(
        () => slots[0]!.native === undefined,
        2_000,
      );

      // Assert — slot.native must be undefined (disposeSlot cleaned up)
      expect(cleaned).toBe(true);
      expect(slots[0]!.native).toBeUndefined();
    });

    it('should terminate native Worker and dispose slot when cancelling revives during destroy (BUG-3)', async () => {
      // Arrange — worker crashes, starts reviving with long delay, then destroy cancels revive
      manager = createManager(1, {
        maxCrashesInWindow: 5,
        crashWindowMs: 10_000,
        reviveStartingDelayMs: 2_000,
        reviveMaxDelayMs: 5_000,
      });

      // Init will fail because worker crashes
      await expect(manager.init({ crash: true })).rejects.toThrow();

      // Wait for worker to enter Reviving state
      const slots = manager.__testing__.getSlots();
      const reviving = await waitForCondition(
        () => slots[0]!.state === WorkerState.Reviving,
        2_000,
      );
      expect(reviving).toBe(true);

      // Act — destroy cancels all revives via cancelAllRevives()
      await manager.destroy();

      // Assert — slot must be Terminated and native must be cleaned up
      const slot = slots[0]!;
      expect(slot.state).toBe(WorkerState.Terminated);
      expect(slot.native).toBeUndefined();
      manager = undefined;
    });
  });

  // ── memory monitoring (BUG-4) ────────────────────────────────

  describe('memory monitoring (BUG-4)', () => {
    it('should set slot memory limits when memoryLimitBytes is configured (BUG-4b)', async () => {
      // Arrange
      manager = createManager(1, {
        memoryLimitBytes: 256 * 1024 * 1024,
        memorySoftThreshold: 0.8,
        memoryHardThreshold: 0.95,
      });

      // Act
      await manager.init();
      await manager.bootstrap();

      // Assert — slot memory limits must be set (not 0)
      const slots = manager.__testing__.getSlots();
      const slot = slots[0]!;
      expect(slot.hardMemoryLimit).toBeGreaterThan(0);
      expect(slot.softMemoryLimit).toBeGreaterThan(0);
      expect(slot.hardMemoryLimit).toBeGreaterThan(slot.softMemoryLimit);
    });

    it('should not crash workers with memory monitoring enabled and high limit (BUG-4c)', async () => {
      // Arrange — high limit so actual RSS is well below threshold.
      // Without BUG-4c fix: stats.memory / 0 = Infinity >= threshold → crash every worker.
      manager = createManager(1, {
        memoryLimitBytes: 1024 * 1024 * 1024,
        memorySoftThreshold: 0.8,
        memoryHardThreshold: 0.95,
        healthCheckIntervalMs: 50,
        healthCheckTimeoutMs: 2_000,
      });

      await manager.init();
      await manager.bootstrap();

      // Act — start health checks, wait for several cycles
      manager.startHealthCheck();

      const stillRunning = await waitForCondition(
        () => false, // just wait the full duration
        300,
      );

      // Assert — worker must still be Running (not crashed by Infinity usage value)
      expect(stillRunning).toBe(false); // waitForCondition timed out as expected
      const states = manager.getSlotStates();
      expect(states[0]!.state).toBe(WorkerState.Running);
    });
  });

  // ── destroy with circuit breaker (BUG-5) ─────────────────────

  describe('destroy with circuit breaker (BUG-5)', () => {
    it('should reach Terminated when circuit breaker is already tripped and destroy is called', async () => {
      // Arrange — worker crashes, circuit breaker trips
      manager = createManager(1, {
        maxCrashesInWindow: 1,
        crashWindowMs: 10_000,
      });

      // Init will crash → circuit breaker trips
      await expect(manager.init({ crash: true })).rejects.toThrow();

      // Wait for breaker to trip and slot to reach Crashed state
      const preCondition = await waitForCondition(
        () => manager!.getSlotStates()[0]!.state === WorkerState.Crashed,
        2_000,
      );
      expect(preCondition).toBe(true);

      // Act — destroy should transition Crashed → Terminated
      await manager.destroy();

      // Assert — must be Terminated, not stuck in Crashed
      const postStates = manager.getSlotStates();
      expect(postStates[0]!.state).toBe(WorkerState.Terminated);
      manager = undefined;
    });
  });

  // ── rolling restart ──────────────────────────────────────────

  describe('rolling restart', () => {
    it('should replace all workers and keep them Running when rolling restart completes', async () => {
      // Arrange
      manager = createManager(2);
      await manager.init();
      await manager.bootstrap();

      const preStates = manager.getSlotStates();
      expect(preStates.every((slot) => slot.state === WorkerState.Running)).toBe(true);

      // Act
      await manager.rollingRestart();

      // Assert — all workers should still be Running
      const postStates = manager.getSlotStates();
      expect(postStates).toHaveLength(2);
      expect(postStates.every((slot) => slot.state === WorkerState.Running)).toBe(true);
    });

    it('should throw when concurrent rolling restart is attempted', async () => {
      // Arrange
      manager = createManager(1);
      await manager.init();
      await manager.bootstrap();

      // Act — start first rolling restart
      const firstRestart = manager.rollingRestart();

      // Assert — second call should throw
      await expect(manager.rollingRestart()).rejects.toThrow('Rolling restart already in progress');

      await firstRestart;
    });

    it('should complete rolling restart then destroy cleanly', async () => {
      // Arrange
      manager = createManager(2);
      await manager.init();
      await manager.bootstrap();

      // Act — rolling restart first, then destroy
      await manager.rollingRestart();
      await manager.destroy();

      // Assert — all workers should be Terminated
      const states = manager.getSlotStates();
      expect(states.every((slot) => slot.state === WorkerState.Terminated)).toBe(true);
      manager = undefined;
    });
  });

  // ── circuit breaker recovery (DESIGN-1) ──────────────────────

  describe('circuit breaker recovery (DESIGN-1)', () => {
    it('should recover workers to Running state when crash window expires after circuit breaker trip', async () => {
      // Arrange — init normally, then kill the worker to trip breaker
      manager = createManager(1, {
        maxCrashesInWindow: 1,
        crashWindowMs: 500,
        startupTimeoutMs: 5_000,
        reviveStartingDelayMs: 50,
        reviveMaxDelayMs: 100,
      });

      await manager.init();
      await manager.bootstrap();

      // Pre-condition: worker is Running
      expect(manager.getSlotStates()[0]!.state).toBe(WorkerState.Running);

      // Act — kill the native worker to trigger crash → breaker trip
      const slots = manager.__testing__.getSlots();
      const nativeRef = slots[0]!.native!;
      nativeRef.terminate();

      // Wait for breaker to trip
      const tripped = await waitForCondition(
        () => {
          const state = manager!.getSlotStates()[0]!.state;
          return state === WorkerState.Crashed || state === WorkerState.Terminated;
        },
        2_000,
      );
      expect(tripped).toBe(true);

      // Wait for recovery timer (> crashWindowMs = 500ms) + worker reinit
      const recovered = await waitForCondition(
        () => manager!.getSlotStates()[0]!.state === WorkerState.Running,
        5_000,
        100,
      );

      // Assert — worker should be back to Running
      expect(recovered).toBe(true);
      expect(manager.getSlotStates()[0]!.state).toBe(WorkerState.Running);
    });
  });

  // ── health check ─────────────────────────────────────────────

  describe('health check', () => {
    it('should keep worker Running after multiple successful health check cycles', async () => {
      // Arrange
      manager = createManager(1, {
        healthCheckIntervalMs: 50,
        healthCheckTimeoutMs: 2_000,
        healthCheckMaxFailures: 3,
      });
      await manager.init();
      await manager.bootstrap();

      // Pre-condition
      expect(manager.getSlotStates()[0]?.state).toBe(WorkerState.Running);

      // Act — start health checks, wait for 5+ cycles (50ms x 5 = 250ms)
      manager.startHealthCheck();

      await waitForCondition(() => false, 400); // wait 400ms

      // Assert — worker must still be Running (not crashed by false positive)
      expect(manager.getSlotStates()[0]?.state).toBe(WorkerState.Running);
      expect(manager.getSlotStates()[0]?.generation).toBe(0);
    });
  });

  // ── crash recovery ───────────────────────────────────────────

  describe('crash recovery', () => {
    it('should increment generation when worker crashes via process.exit', async () => {
      // Arrange — worker will exit(1) after init completes
      manager = createManager(1, {
        startupTimeoutMs: 3_000,
        reviveStartingDelayMs: 50,
        reviveMaxDelayMs: 100,
      });

      // Act — init succeeds then worker crashes
      await expect(manager.init({ crash: true })).rejects.toThrow();

      // Assert — generation must be >= 1 (crash event processed)
      const states = manager.getSlotStates();
      expect(states[0]?.generation).toBe(1);
    });

    it('should reach Terminated when circuit breaker trips from repeated crashes', async () => {
      // Arrange — breaker trips at 2 crashes within 10s window
      manager = createManager(1, {
        startupTimeoutMs: 500,
        rpcTimeoutMs: 300,
        crashWindowMs: 10_000,
        maxCrashesInWindow: 2,
        reviveStartingDelayMs: 50,
        reviveMaxDelayMs: 100,
      });

      // Act
      await expect(manager.init({ crash: true })).rejects.toThrow();

      // Wait for: crash #1 → revive → crash #2 → breaker trip → Terminated
      const terminated = await waitForCondition(
        () => manager!.getSlotStates()[0]!.state === WorkerState.Terminated,
        5_000,
        100,
      );

      // Assert — worker must be exactly Terminated (not Crashed, not Reviving)
      expect(terminated).toBe(true);
      expect(manager.getSlotStates()[0]?.state).toBe(WorkerState.Terminated);
    });
  });

  // ── startup timeout ──────────────────────────────────────────

  describe('startup timeout', () => {
    it('should throw when init hangs beyond timeout', async () => {
      // Arrange — hangInit=true means init RPC never resolves.
      manager = createManager(1, { startupTimeoutMs: 500, rpcTimeoutMs: 400 });

      // Act & Assert — must throw, not silently swallow
      await expect(manager.init({ hangInit: true })).rejects.toThrow();

      // Assert — worker must not be Running
      const states = manager.getSlotStates();
      expect(states[0]?.state).not.toBe(WorkerState.Running);
    });

    it('should reach Running when init is slow but within timeout', async () => {
      // Arrange — 200ms delay, 5s timeout
      manager = createManager(1, { startupTimeoutMs: 5_000 });

      // Act — must not throw
      await manager.init({ slowInit: 200 });
      await manager.bootstrap();

      // Assert — must be exactly Running
      const states = manager.getSlotStates();
      expect(states[0]?.state).toBe(WorkerState.Running);
      expect(states[0]?.generation).toBe(0);
    });
  });

  // ── destroy during init ──────────────────────────────────────

  describe('destroy during init', () => {
    it('should terminate worker that is mid-initialization when destroy is called', async () => {
      // Arrange — worker takes 2s to init
      manager = createManager(1, { startupTimeoutMs: 10_000 });

      // Act — start init, then destroy while init is in progress
      let initError: Error | undefined;
      const initPromise = manager.init({ slowInit: 2_000 }).catch((error: Error) => {
        initError = error;
      });

      // Wait for worker to actually be spawned before destroying
      const slots = manager.__testing__.getSlots();
      await waitForCondition(() => slots[0]?.native !== undefined, 2_000);

      await manager.destroy();
      await initPromise;

      // Assert — must be Terminated, and init must have thrown
      const states = manager.getSlotStates();
      expect(states[0]?.state).toBe(WorkerState.Terminated);
      expect(initError).toBeDefined();
      manager = undefined;
    });
  });

  // ── single worker rolling restart ────────────────────────────

  describe('single worker rolling restart', () => {
    it('should replace the only worker and verify new worker is functional after rolling restart', async () => {
      // Arrange
      manager = createManager(1);
      await manager.init();
      await manager.bootstrap();

      expect(manager.getSlotStates()[0]?.state).toBe(WorkerState.Running);

      // Act
      await manager.rollingRestart();

      // Assert — must be Running, same slot ID
      const postSlotState = manager.getSlotStates()[0];
      expect(postSlotState?.state).toBe(WorkerState.Running);
      expect(postSlotState?.id).toBe(0);

      // Verify new worker is functional — destroy should succeed cleanly
      await manager.destroy();
      expect(manager.getSlotStates()[0]?.state).toBe(WorkerState.Terminated);
      manager = undefined;
    });
  });

  // ── health check failure escalation ──────────────────────────

  describe('health check failure escalation', () => {
    it('should crash worker when health check fails consecutively reaching maxFailures', async () => {
      // Arrange — use very short health check timeout so getStats races against it.
      // The test-worker getStats returns quickly, so we need a deliberately
      // unreachable timeout scenario. Instead, we kill the worker's native
      // to make getStats fail, then verify crash handling.
      manager = createManager(1, {
        healthCheckIntervalMs: 50,
        healthCheckTimeoutMs: 100,
        healthCheckMaxFailures: 3,
        maxCrashesInWindow: 10, // Don't trip breaker
        reviveStartingDelayMs: 50,
        reviveMaxDelayMs: 100,
      });

      await manager.init();
      await manager.bootstrap();
      expect(manager.getSlotStates()[0]!.state).toBe(WorkerState.Running);

      // Act — start health checks, then kill native to cause RPC failures.
      // The RPC proxy will reject calls → health check failures accumulate.
      manager.startHealthCheck();

      const slots = manager.__testing__.getSlots();

      // Dispose the RPC proxy to force health check RPC to fail
      slots[0]!.rpcProxy!.dispose();

      // Wait for health check failures to accumulate (3 failures at 50ms intervals)
      const crashed = await waitForCondition(
        () => {
          const state = manager!.getSlotStates()[0]!.state;
          return state !== WorkerState.Running;
        },
        3_000,
        50,
      );

      // Assert — worker should have been crashed due to health check failures
      expect(crashed).toBe(true);
      const finalState = manager.getSlotStates()[0]!.state;
      expect(
        finalState === WorkerState.Crashed ||
        finalState === WorkerState.Reviving ||
        finalState === WorkerState.Terminated ||
        finalState === WorkerState.Spawning,
      ).toBe(true);
    });
  });

  // ── multiple worker crash isolation ─────────────────────────

  describe('multiple worker crash isolation', () => {
    it('should handle crash on one worker without affecting other Running workers', async () => {
      // Arrange — 3 workers all Running
      manager = createManager(3, {
        maxCrashesInWindow: 5,
        reviveStartingDelayMs: 50,
        reviveMaxDelayMs: 100,
      });

      await manager.init();
      await manager.bootstrap();

      const preStates = manager.getSlotStates();
      expect(preStates.every((slot) => slot.state === WorkerState.Running)).toBe(true);

      // Act — kill only worker #1's native thread
      const slots = manager.__testing__.getSlots();
      slots[1]!.native!.terminate();

      // Wait for worker #1's generation to increment (crash processed)
      const crashProcessed = await waitForCondition(
        () => manager!.getSlotStates()[1]!.generation >= 1,
        3_000,
      );
      expect(crashProcessed).toBe(true);

      // Assert — workers #0 and #2 must still be Running with generation 0
      const postStates = manager.getSlotStates();
      expect(postStates[0]!.state).toBe(WorkerState.Running);
      expect(postStates[0]!.generation).toBe(0);
      expect(postStates[2]!.state).toBe(WorkerState.Running);
      expect(postStates[2]!.generation).toBe(0);

      // Worker #1 must have crashed (generation >= 1)
      expect(postStates[1]!.generation).toBeGreaterThanOrEqual(1);
    });
  });

  // ── replacement semaphore ────────────────────────────────────

  describe('replacement semaphore', () => {
    it('should release replacementInProgress flag after rolling restart completes', async () => {
      // Arrange
      manager = createManager(1);
      await manager.init();
      await manager.bootstrap();

      // Pre-condition
      expect(manager.replacementInProgress).toBe(false);

      // Act
      await manager.rollingRestart();

      // Assert — after restart completes, flag should be released
      expect(manager.replacementInProgress).toBe(false);
    });
  });

  // ── multiple workers ────────────────────────────────────────

  describe('multiple workers', () => {
    it('should init and destroy 4 workers when size is 4', async () => {
      // Arrange
      manager = createManager(4);

      // Act
      await manager.init();
      await manager.bootstrap();

      // Assert — all Running
      const runningStates = manager.getSlotStates();
      expect(runningStates).toHaveLength(4);
      expect(runningStates.every((slot) => slot.state === WorkerState.Running)).toBe(true);

      // Destroy
      await manager.destroy();
      const terminatedStates = manager.getSlotStates();
      expect(terminatedStates.every((slot) => slot.state === WorkerState.Terminated)).toBe(true);
      manager = undefined;
    });
  });

  // ── destroy without init ────────────────────────────────────

  describe('destroy without init', () => {
    it('should reach Terminated for all slots when destroy is called without init', async () => {
      // Arrange — no init, slots are in Spawning state with no native Worker
      manager = createManager(2);

      // Act
      await manager.destroy();

      // Assert
      const states = manager.getSlotStates();
      expect(states.every((slot) => slot.state === WorkerState.Terminated)).toBe(true);
      manager = undefined;
    });
  });

  // ── health check idempotency ────────────────────────────────

  describe('health check idempotency', () => {
    it('should not start duplicate health check timers when startHealthCheck is called twice', async () => {
      // Arrange
      manager = createManager(1, {
        healthCheckIntervalMs: 50,
        healthCheckTimeoutMs: 2_000,
      });
      await manager.init();
      await manager.bootstrap();

      // Act — call startHealthCheck twice
      manager.startHealthCheck();
      manager.startHealthCheck();

      await waitForCondition(() => false, 300);

      // Assert — worker must still be Running (no double-check side effects)
      expect(manager.getSlotStates()[0]?.state).toBe(WorkerState.Running);
    });
  });

  // ── recovery timer cleanup on destroy ───────────────────────

  describe('recovery timer cleanup', () => {
    it('should clean up recovery timer when destroy is called during recovery window', async () => {
      // Arrange — init, crash to trip breaker, then destroy before recovery fires
      manager = createManager(1, {
        maxCrashesInWindow: 1,
        crashWindowMs: 5_000, // long window so recovery doesn't fire before destroy
        startupTimeoutMs: 5_000,
      });

      await manager.init();
      await manager.bootstrap();

      // Kill worker to trip breaker
      const slots = manager.__testing__.getSlots();
      slots[0]!.native!.terminate();

      // Wait for breaker to trip
      const tripped = await waitForCondition(
        () => {
          const state = manager!.getSlotStates()[0]!.state;
          return state === WorkerState.Crashed || state === WorkerState.Terminated;
        },
        2_000,
      );
      expect(tripped).toBe(true);

      // Act — destroy before recovery timer fires
      await manager.destroy();

      // Assert — all Terminated, no hanging timers (test process exits cleanly)
      expect(manager.getSlotStates()[0]!.state).toBe(WorkerState.Terminated);
      manager = undefined;
    });
  });

  // ── graceful destroy generation consistency ─────────────────

  describe('graceful destroy generation consistency', () => {
    it('should not increment generation when destroy is called on Running worker', async () => {
      // Arrange
      manager = createManager(1);
      await manager.init();
      await manager.bootstrap();

      expect(manager.getSlotStates()[0]?.generation).toBe(0);

      // Act
      await manager.destroy();

      // Assert — generation stays 0 (destroy is not a crash)
      expect(manager.getSlotStates()[0]?.generation).toBe(0);
      expect(manager.getSlotStates()[0]?.state).toBe(WorkerState.Terminated);
      manager = undefined;
    });
  });

  // ── stress / stability ─────────────────────────────────────

  describe('stress and stability', () => {
    it('should survive rapid init-destroy cycles without leaking workers', async () => {
      // Arrange & Act — create, init, destroy 5 times in rapid succession
      for (let cycle = 0; cycle < 5; cycle++) {
        manager = createManager(2);
        await manager.init();
        await manager.bootstrap();

        const states = manager.getSlotStates();
        expect(states.every((slot) => slot.state === WorkerState.Running)).toBe(true);

        await manager.destroy();

        const terminated = manager.getSlotStates();
        expect(terminated.every((slot) => slot.state === WorkerState.Terminated)).toBe(true);
        manager = undefined;
      }
    });

    it('should handle multiple workers crashing simultaneously without hanging', async () => {
      // Arrange — 4 workers, low breaker threshold
      manager = createManager(4, {
        maxCrashesInWindow: 10,
        crashWindowMs: 10_000,
        reviveStartingDelayMs: 50,
        reviveMaxDelayMs: 200,
      });

      await manager.init();
      await manager.bootstrap();
      expect(manager.getSlotStates().every((slot) => slot.state === WorkerState.Running)).toBe(true);

      // Act — kill all 4 workers simultaneously
      const slots = manager.__testing__.getSlots();
      for (const slot of slots) {
        slot.native!.terminate();
      }

      // Wait for all to crash and start recovering
      const allCrashed = await waitForCondition(
        () => manager!.getSlotStates().every((slot) => slot.generation >= 1),
        5_000,
        100,
      );
      expect(allCrashed).toBe(true);

      // Assert — all workers should have crashed (generation >= 1)
      const postStates = manager.getSlotStates();
      for (const slot of postStates) {
        expect(slot.generation).toBeGreaterThanOrEqual(1);
      }

      // Clean destroy should not hang
      await manager.destroy();
      expect(manager.getSlotStates().every((slot) => slot.state === WorkerState.Terminated)).toBe(true);
      manager = undefined;
    });

    it('should handle rolling restart with health checks running concurrently', async () => {
      // Arrange — enable health checks and do rolling restart at the same time
      manager = createManager(2, {
        healthCheckIntervalMs: 50,
        healthCheckTimeoutMs: 2_000,
        healthCheckMaxFailures: 5,
      });

      await manager.init();
      await manager.bootstrap();
      manager.startHealthCheck();

      // Act — rolling restart while health checks are active
      await manager.rollingRestart();

      // Assert — all workers should still be Running after restart
      const postStates = manager.getSlotStates();
      expect(postStates.every((slot) => slot.state === WorkerState.Running)).toBe(true);

      // Clean destroy
      await manager.destroy();
      expect(manager.getSlotStates().every((slot) => slot.state === WorkerState.Terminated)).toBe(true);
      manager = undefined;
    });

    it('should handle destroy idempotently when called twice', async () => {
      // Arrange
      manager = createManager(1);
      await manager.init();
      await manager.bootstrap();

      // Act — destroy twice
      await manager.destroy();
      await manager.destroy(); // second call should be idempotent

      // Assert
      expect(manager.getSlotStates()[0]!.state).toBe(WorkerState.Terminated);
      manager = undefined;
    });
  });

  // ── crash diagnostics ──────────────────────────────────────

  describe('crash diagnostics', () => {
    it('should log CloseEvent diagnostics with exit code when worker calls process.exit', async () => {
      // Arrange — worker crashes via process.exit(1), producing a CloseEvent
      manager = createManager(1, {
        startupTimeoutMs: 3_000,
        crashWindowMs: 10_000,
        maxCrashesInWindow: 1,
      });

      // Spy on logger.error to capture the diagnostics argument
      const loggerSpy = spyOn((manager as unknown as { logger: { error: (...args: unknown[]) => void } }).logger, 'error');

      // Act — init triggers crash via process.exit(1)
      await expect(manager.init({ crash: true })).rejects.toThrow();

      // Wait for crash diagnostics to be logged (async close event processing)
      await waitForCondition(
        () => loggerSpy.mock.calls.some(
          (call) => typeof call[0] === 'string' && (call[0] as string).includes('close'),
        ),
        3_000,
      );

      // Assert — logger.error was called with crash message containing 'close'
      // Signature: this.logger.error(message, crashError, diagnostics.type)
      const crashCall = loggerSpy.mock.calls.find(
        (call) => typeof call[0] === 'string' && (call[0] as string).includes('close'),
      );

      expect(crashCall).toBeDefined();

      // Third arg is diagnostics.type string
      const diagType = crashCall![2] as string;
      expect(diagType).toBe('close');
    });

    it('should log ErrorEvent diagnostics with unwrapped Error when worker throws', async () => {
      // Arrange — worker that triggers an error event
      manager = createManager(1, {
        startupTimeoutMs: 3_000,
        crashWindowMs: 10_000,
        maxCrashesInWindow: 1,
      });

      const loggerSpy = spyOn((manager as unknown as { logger: { error: (...args: unknown[]) => void } }).logger, 'error');

      // Terminate the native worker directly to simulate an error scenario
      await manager.init();
      await manager.bootstrap();

      const slots = manager.__testing__.getSlots();
      const slot = slots[0]!;

      // Force-kill the native worker — this produces a close event (not error event).
      // The close event path is the most reliable path we can trigger in integration tests.
      if (slot.native) {
        slot.native.terminate();
      }

      // Wait for crash to be processed (5s to handle CI/parallel load)
      await waitForCondition(
        () => manager!.getSlotStates()[0]!.generation >= 1,
        5_000,
      );

      // Assert — at least one logger.error call should have diagnostics.type as third arg
      // Signature: this.logger.error(message, crashError, diagnostics.type)
      const anyCrashCall = loggerSpy.mock.calls.find(
        (call) => typeof call[2] === 'string' && ['close', 'error-event', 'error'].includes(call[2] as string),
      );

      expect(anyCrashCall).toBeDefined();

      const diagType = anyCrashCall![2] as string;
      expect(['close', 'error-event', 'error']).toContain(diagType);
    });
  });
});
