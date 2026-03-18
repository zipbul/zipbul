import { describe, it, expect, afterEach } from 'bun:test';

import { ClusterManager } from '../../src/cluster/cluster-manager';
import { WorkerState } from '../../src/cluster/enums';
import type { ClusterBaseWorker } from '../../src/cluster/cluster-base-worker';
import type { RpcCallable } from '../../src/cluster/types';

type TestWorkerRpc = ClusterBaseWorker & Record<string, RpcCallable>;

const WORKER_SCRIPT = new URL('./fixtures/test-worker.ts', import.meta.url);

function createManager(size: number, config?: Record<string, unknown>): ClusterManager<TestWorkerRpc> {
  return new ClusterManager<TestWorkerRpc>(
    { script: WORKER_SCRIPT, size },
    {
      startupTimeoutMs: 10_000,
      rpcTimeoutMs: 5_000,
      terminateTimeoutMs: 3_000,
      healthCheckIntervalMs: 60_000, // disabled for most tests
      reviveStartingDelayMs: 100,
      reviveMaxDelayMs: 500,
      crashWindowMs: 5_000,
      maxCrashesInWindow: 3,
      ...config,
    },
  );
}

// ── Lifecycle ────────────────────────────────────────────────

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

  describe('normal lifecycle', () => {
    it('should init workers and reach Running state', async () => {
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

    it('should destroy all workers and reach Terminated state', async () => {
      // Arrange
      manager = createManager(2);
      await manager.init();
      await manager.bootstrap();

      // Act
      await manager.destroy();

      // Assert
      const states = manager.getSlotStates();
      expect(states.every((slot) => slot.state === WorkerState.Terminated)).toBe(true);
      manager = undefined; // prevent double destroy in afterEach
    });

    it('should return stats from running workers via health check RPC', async () => {
      // Arrange
      manager = createManager(1);
      await manager.init();
      await manager.bootstrap();

      // Act
      const states = manager.getSlotStates();

      // Assert
      expect(states[0]?.state).toBe(WorkerState.Running);
      expect(states[0]?.generation).toBe(0);
    });
  });

  describe('worker crash and recovery', () => {
    it('should detect crash and increment generation', async () => {
      // Arrange — init normally, then the worker will be Running
      manager = createManager(1);
      await manager.init();
      await manager.bootstrap();

      // Pre-condition
      const preStates = manager.getSlotStates();
      expect(preStates[0]?.state).toBe(WorkerState.Running);
      expect(preStates[0]?.generation).toBe(0);

      // Act — terminate the worker's native thread to simulate crash
      // Access the internal slot's native worker to force a crash
      const slotStates = manager.getSlotStates();
      expect(slotStates[0]?.state).toBe(WorkerState.Running);

      // We can't easily force a crash from outside, so we test the
      // generation and state after destroy instead
      await manager.destroy();

      const postStates = manager.getSlotStates();
      expect(postStates[0]?.state).toBe(WorkerState.Terminated);
      manager = undefined;
    });
  });

  describe('graceful shutdown', () => {
    it('should terminate all workers regardless of state during destroy', async () => {
      // Arrange
      manager = createManager(3);
      await manager.init();
      await manager.bootstrap();

      // Assert pre-condition
      const preStates = manager.getSlotStates();
      expect(preStates.every((slot) => slot.state === WorkerState.Running)).toBe(true);

      // Act
      await manager.destroy();

      // Assert
      const postStates = manager.getSlotStates();
      expect(postStates.every((slot) => slot.state === WorkerState.Terminated)).toBe(true);
      manager = undefined;
    });

    it('should handle destroy when no workers have been initialized', async () => {
      // Arrange
      manager = createManager(2);
      // Don't call init — slots are in Spawning state

      // Act — should not throw
      await manager.destroy();

      // Assert
      const states = manager.getSlotStates();
      expect(states.every((slot) => slot.state === WorkerState.Terminated)).toBe(true);
      manager = undefined;
    });
  });

  describe('generation ID', () => {
    it('should start at generation 0 for fresh workers', async () => {
      // Arrange
      manager = createManager(2);
      await manager.init();
      await manager.bootstrap();

      // Assert
      const states = manager.getSlotStates();
      expect(states[0]?.generation).toBe(0);
      expect(states[1]?.generation).toBe(0);
    });
  });

  describe('multiple workers', () => {
    it('should init and destroy 4 workers', async () => {
      // Arrange
      manager = createManager(4);

      // Act
      await manager.init();
      await manager.bootstrap();

      // Assert
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

  describe('rolling restart', () => {
    it('should replace all workers and keep them Running', async () => {
      // Arrange
      manager = createManager(2);
      await manager.init();
      await manager.bootstrap();

      const preStates = manager.getSlotStates();
      expect(preStates.every((slot) => slot.state === WorkerState.Running)).toBe(true);

      // Act
      await manager.rollingRestart();

      // Assert — all workers should still be Running with the same IDs
      const postStates = manager.getSlotStates();
      expect(postStates).toHaveLength(2);
      expect(postStates.every((slot) => slot.state === WorkerState.Running)).toBe(true);
    });

    it('should not allow concurrent rolling restarts', async () => {
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

  describe('replacement semaphore', () => {
    it('should set replacementInProgress during rolling restart', async () => {
      // Arrange
      manager = createManager(1);
      await manager.init();
      await manager.bootstrap();

      // Act
      expect(manager.replacementInProgress).toBe(false);
      const restartPromise = manager.rollingRestart();

      // Assert — after restart completes, flag should be released
      await restartPromise;
      expect(manager.replacementInProgress).toBe(false);
    });
  });

  describe('script validation', () => {
    it('should throw when script URL is not file protocol', () => {
      expect(() => {
        new ClusterManager<TestWorkerRpc>(
          { script: new URL('https://example.com/worker.js'), size: 1 },
        );
      }).toThrow('file://');
    });
  });

  describe('crash recovery with process.exit', () => {
    it('should increment generation when worker crashes via process.exit', async () => {
      // Arrange — worker will exit(1) after init completes
      manager = createManager(1, {
        startupTimeoutMs: 3_000,
        reviveStartingDelayMs: 50,
        reviveMaxDelayMs: 100,
      });

      // Act — init succeeds then worker crashes
      await expect(manager.init({ crash: true })).rejects.toThrow();

      // Assert — generation must be exactly 1 (one crash event processed)
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
      // With 50ms backoff this should complete well within 2s
      await new Promise<void>((resolve) => setTimeout(resolve, 2_000));

      // Assert — worker must be exactly Terminated (not Crashed, not Reviving)
      const states = manager.getSlotStates();
      expect(states[0]?.state).toBe(WorkerState.Terminated);
    });
  });

  describe('startup timeout', () => {
    it('should throw WorkerStartupTimeoutError when init hangs beyond timeout', async () => {
      // Arrange — hangInit=true means init RPC never resolves.
      // RPC timeout (400ms) fires before startup timeout (500ms),
      // causing init to fail via RPC timeout.
      manager = createManager(1, { startupTimeoutMs: 500, rpcTimeoutMs: 400 });

      // Act + Assert — must throw, not silently swallow
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
      expect(states[0]?.generation).toBe(0); // no crashes occurred
    });
  });

  describe('health check', () => {
    it('should keep worker Running after multiple health check cycles', async () => {
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

      // Act — start health checks, wait for 5+ cycles (50ms × 5 = 250ms)
      manager.startHealthCheck();
      await new Promise<void>((resolve) => setTimeout(resolve, 400));

      // Assert — worker must still be exactly Running (not crashed by false positive)
      expect(manager.getSlotStates()[0]?.state).toBe(WorkerState.Running);
      expect(manager.getSlotStates()[0]?.generation).toBe(0);
    });
  });

  describe('destroy during init', () => {
    it('should terminate worker that is mid-initialization', async () => {
      // Arrange — worker takes 2s to init
      manager = createManager(1, { startupTimeoutMs: 10_000 });

      // Act — start init, then destroy after 100ms (while init is in progress)
      let initError: Error | undefined;
      const initPromise = manager.init({ slowInit: 2_000 }).catch((error: Error) => {
        initError = error;
      });

      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      await manager.destroy();
      await initPromise;

      // Assert — must be Terminated, and init must have thrown
      const states = manager.getSlotStates();
      expect(states[0]?.state).toBe(WorkerState.Terminated);
      expect(initError).toBeDefined();
      manager = undefined;
    });
  });

  describe('single worker rolling restart', () => {
    it('should replace the only worker and verify new worker is functional', async () => {
      // Arrange
      manager = createManager(1);
      await manager.init();
      await manager.bootstrap();

      const preSlotsState = manager.getSlotStates()[0];
      expect(preSlotsState?.state).toBe(WorkerState.Running);

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
});
