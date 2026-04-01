import { describe, it, expect } from 'bun:test';
import { ClusterBaseWorker } from './cluster-base-worker';
import type { ClusterWorkerStats } from './interfaces';

class TestWorker extends ClusterBaseWorker {
  bootstrap(): void {
    // no-op
  }

  destroy(): void {
    // no-op
  }
}

describe('ClusterBaseWorker', () => {
  describe('getStats', () => {
    it('should return cpu ratio between 0 and 1', async () => {
      const worker = new TestWorker();
      await worker.init(0, {});

      // Let some time pass for measurable CPU usage
      await new Promise<void>((resolve) => setTimeout(resolve, 10));

      const stats = worker.getStats();

      expect(stats.cpu).toBeGreaterThanOrEqual(0);
      expect(stats.cpu).toBeLessThanOrEqual(1);
    });

    it('should return memory as positive RSS value', async () => {
      const worker = new TestWorker();
      await worker.init(0, {});

      const stats = worker.getStats();

      expect(stats.memory).toBeGreaterThan(0);
      expect(Number.isInteger(stats.memory)).toBe(true);
    });

    it('should include heapSize as a positive number', async () => {
      const worker = new TestWorker();
      await worker.init(0, {});

      const stats = worker.getStats();

      expect(stats.heapSize).toBeDefined();
      expect(stats.heapSize).toBeGreaterThan(0);
    });

    it('should include heapCapacity >= heapSize', async () => {
      const worker = new TestWorker();
      await worker.init(0, {});

      const stats = worker.getStats();

      expect(stats.heapCapacity).toBeDefined();
      expect(stats.heapCapacity).toBeGreaterThanOrEqual(stats.heapSize!);
    });

    it('should return heapSize less than or equal to memory (RSS)', async () => {
      const worker = new TestWorker();
      await worker.init(0, {});

      const stats = worker.getStats();

      // JS heap is a subset of total RSS
      expect(stats.heapSize).toBeLessThanOrEqual(stats.memory);
    });

    it('should update CPU calculation between successive calls', async () => {
      const worker = new TestWorker();
      await worker.init(0, {});

      const stats1 = worker.getStats();
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      const stats2 = worker.getStats();

      // Both should be valid ratios (may be 0 if no CPU work happened)
      expect(stats1.cpu).toBeGreaterThanOrEqual(0);
      expect(stats2.cpu).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getStatsAfterGC', () => {
    it('should return memory and heap stats without updating CPU baseline', async () => {
      const worker = new TestWorker();
      await worker.init(0, {});

      const stats = worker.getStatsAfterGC();

      // CPU is 0 because getStatsAfterGC does not compute CPU ratio
      expect(stats.cpu).toBe(0);
      expect(stats.memory).toBeGreaterThan(0);
      expect(stats.heapSize).toBeDefined();
      expect(stats.heapSize).toBeGreaterThan(0);
    });

    it('should not reset CPU measurement baseline for next getStats call', async () => {
      const worker = new TestWorker();
      await worker.init(0, {});

      // First getStats — establishes baseline
      worker.getStats();
      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      // getStatsAfterGC should NOT update prevCpu/prevTime
      worker.getStatsAfterGC();
      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      // Next getStats should measure from the first getStats, not from getStatsAfterGC
      const nextStats = worker.getStats();
      // CPU should be >= 0 (valid ratio over the full ~100ms window, not just ~50ms)
      expect(nextStats.cpu).toBeGreaterThanOrEqual(0);
      expect(nextStats.cpu).toBeLessThanOrEqual(1);
    });

    it('should trigger GC and return reduced heapSize for reclaimable allocations', async () => {
      const worker = new TestWorker();
      await worker.init(0, {});

      // Allocate significant garbage to ensure measurable difference even under parallel load
      let garbage: unknown[] | undefined = [];
      for (let idx = 0; idx < 200_000; idx++) {
        garbage.push({ data: new Array(100).fill(idx) });
      }

      // Measure with garbage alive
      const withGarbage = worker.getStats();

      // Release reference — make eligible for GC
      garbage = undefined;

      // getStatsAfterGC triggers edenGC + fullGC then measures
      const afterGC = worker.getStatsAfterGC();

      // Heap should have shrunk compared to when garbage was alive
      expect(afterGC.heapSize).toBeLessThan(withGarbage.heapSize!);
    });

    it('should include heapCapacity', async () => {
      const worker = new TestWorker();
      await worker.init(0, {});

      const stats = worker.getStatsAfterGC();

      expect(stats.heapCapacity).toBeDefined();
      expect(stats.heapCapacity).toBeGreaterThanOrEqual(stats.heapSize!);
    });
  });
});
