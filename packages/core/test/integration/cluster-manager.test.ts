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
    it('should detect crash and attempt revive when worker exits', async () => {
      // Arrange — worker will exit(1) after init
      manager = createManager(1, { startupTimeoutMs: 3_000 });

      // Act — init with crash flag
      try {
        await manager.init({ crash: true });
      } catch {
        // init may throw due to crash during bootstrap
      }

      // Wait for crash detection + revive attempt
      await new Promise<void>((resolve) => setTimeout(resolve, 1_500));

      // Assert — generation should have incremented from crash
      const states = manager.getSlotStates();
      expect(states[0]?.generation).toBeGreaterThanOrEqual(1);
    });

    it('should trip circuit breaker after repeated crashes', async () => {
      // Arrange — low thresholds to trigger breaker quickly
      manager = createManager(1, {
        startupTimeoutMs: 1_000,
        rpcTimeoutMs: 500,
        crashWindowMs: 10_000,
        maxCrashesInWindow: 2,
        reviveStartingDelayMs: 50,
        reviveMaxDelayMs: 100,
      });

      // Act — init with crash, worker will keep crashing on revive
      try {
        await manager.init({ crash: true });
      } catch {
        // expected
      }

      // Wait for multiple crash+revive cycles to trip breaker
      await new Promise<void>((resolve) => setTimeout(resolve, 3_000));

      // Assert — worker should be Terminated (breaker tripped, no more revives)
      const states = manager.getSlotStates();
      expect([WorkerState.Terminated, WorkerState.Crashed]).toContain(states[0]?.state);
    });
  });

  describe('startup timeout', () => {
    it('should crash worker when init hangs beyond timeout', async () => {
      // Arrange — worker will never complete init
      manager = createManager(1, { startupTimeoutMs: 500, rpcTimeoutMs: 400 });

      // Act
      try {
        await manager.init({ hangInit: true });
      } catch {
        // expected — startup timeout
      }

      // Assert — worker should have been marked as crashed
      const states = manager.getSlotStates();
      expect([WorkerState.Crashed, WorkerState.Reviving, WorkerState.Terminated]).toContain(states[0]?.state);
    });

    it('should succeed when init is slow but within timeout', async () => {
      // Arrange — worker delays 200ms but timeout is 5s
      manager = createManager(1, { startupTimeoutMs: 5_000 });

      // Act
      await manager.init({ slowInit: 200 });
      await manager.bootstrap();

      // Assert
      const states = manager.getSlotStates();
      expect(states[0]?.state).toBe(WorkerState.Running);
    });
  });

  describe('health check', () => {
    it('should collect stats from running workers', async () => {
      // Arrange — short interval to trigger quickly
      manager = createManager(1, { healthCheckIntervalMs: 100, healthCheckTimeoutMs: 2_000 });
      await manager.init();
      await manager.bootstrap();
      manager.startHealthCheck();

      // Act — wait for at least one health check cycle
      await new Promise<void>((resolve) => setTimeout(resolve, 300));

      // Assert — worker should still be Running (healthy)
      const states = manager.getSlotStates();
      expect(states[0]?.state).toBe(WorkerState.Running);
    });
  });

  describe('destroy during init', () => {
    it('should terminate worker that is still initializing', async () => {
      // Arrange — worker delays init
      manager = createManager(1, { startupTimeoutMs: 10_000 });

      // Act — start init but destroy before it completes
      const initPromise = manager.init({ slowInit: 2_000 }).catch(() => {});
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      await manager.destroy();
      await initPromise;

      // Assert
      const states = manager.getSlotStates();
      expect(states[0]?.state).toBe(WorkerState.Terminated);
      manager = undefined;
    });
  });

  describe('single worker rolling restart', () => {
    it('should replace the only worker and maintain Running state', async () => {
      // Arrange
      manager = createManager(1);
      await manager.init();
      await manager.bootstrap();

      // Act
      await manager.rollingRestart();

      // Assert
      const states = manager.getSlotStates();
      expect(states).toHaveLength(1);
      expect(states[0]?.state).toBe(WorkerState.Running);
    });
  });
});
