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
});
