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
    it('should return valid stats after triggering GC', async () => {
      const worker = new TestWorker();
      await worker.init(0, {});

      const stats = worker.getStatsAfterGC();

      expect(stats.cpu).toBeGreaterThanOrEqual(0);
      expect(stats.cpu).toBeLessThanOrEqual(1);
      expect(stats.memory).toBeGreaterThan(0);
      expect(stats.heapSize).toBeDefined();
      expect(stats.heapSize).toBeGreaterThan(0);
    });

    it('should trigger GC and return reduced heapSize for reclaimable allocations', async () => {
      const worker = new TestWorker();
      await worker.init(0, {});

      // Measure baseline
      const baseline = worker.getStats();

      // Allocate garbage
      let garbage: unknown[] | undefined = [];
      for (let idx = 0; idx < 50_000; idx++) {
        garbage.push({ data: new Array(100).fill(idx) });
      }

      // Measure with garbage alive
      const withGarbage = worker.getStats();
      expect(withGarbage.heapSize).toBeGreaterThan(baseline.heapSize!);

      // Release reference — make eligible for GC
      garbage = undefined;

      // getStatsAfterGC triggers edenGC then measures
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
