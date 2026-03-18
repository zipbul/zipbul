import { describe, it, expect } from 'bun:test';
import { evaluateMemoryAction, MemoryAction } from './memory-pressure';
import type { ClusterWorkerStats } from './interfaces';

function makeStats(memory: number, heapSize?: number, heapCapacity?: number): ClusterWorkerStats {
  return { cpu: 0.1, memory, heapSize, heapCapacity };
}

describe('evaluateMemoryAction', () => {
  const softLimit = 200;
  const hardLimit = 400;

  describe('below soft limit', () => {
    it('should return None when RSS is below soft limit', () => {
      const result = evaluateMemoryAction(makeStats(100), softLimit, hardLimit);
      expect(result).toBe(MemoryAction.None);
    });

    it('should return None when RSS equals soft limit minus 1', () => {
      const result = evaluateMemoryAction(makeStats(199), softLimit, hardLimit);
      expect(result).toBe(MemoryAction.None);
    });
  });

  describe('at or above hard limit', () => {
    it('should return HardCrash when RSS reaches hard limit', () => {
      const result = evaluateMemoryAction(makeStats(400), softLimit, hardLimit);
      expect(result).toBe(MemoryAction.HardCrash);
    });

    it('should return HardCrash when RSS exceeds hard limit', () => {
      const result = evaluateMemoryAction(makeStats(500), softLimit, hardLimit);
      expect(result).toBe(MemoryAction.HardCrash);
    });

    it('should return HardCrash even if heapSize is low', () => {
      // RSS is above hard limit — always crash regardless of heap
      const result = evaluateMemoryAction(makeStats(400, 50, 100), softLimit, hardLimit);
      expect(result).toBe(MemoryAction.HardCrash);
    });
  });

  describe('between soft and hard limit — no heap data', () => {
    it('should return SoftRecycle when RSS is at soft limit and no heapSize available', () => {
      const result = evaluateMemoryAction(makeStats(200), softLimit, hardLimit);
      expect(result).toBe(MemoryAction.SoftRecycle);
    });

    it('should return SoftRecycle when RSS is between soft and hard with no heapSize', () => {
      const result = evaluateMemoryAction(makeStats(300), softLimit, hardLimit);
      expect(result).toBe(MemoryAction.SoftRecycle);
    });
  });

  describe('between soft and hard limit — with heap data', () => {
    it('should return SoftRecycle when heapSize is also above soft limit', () => {
      // Both RSS and heap are high — genuine memory pressure
      const result = evaluateMemoryAction(makeStats(300, 250, 300), softLimit, hardLimit);
      expect(result).toBe(MemoryAction.SoftRecycle);
    });

    it('should return None when RSS is above soft limit but heapSize is below soft limit', () => {
      // RSS is inflated by non-heap memory (mmap, file cache) — not a real leak
      const result = evaluateMemoryAction(makeStats(300, 100, 200), softLimit, hardLimit);
      expect(result).toBe(MemoryAction.None);
    });

    it('should return SoftRecycle when heapSize exactly equals soft limit', () => {
      const result = evaluateMemoryAction(makeStats(300, 200, 300), softLimit, hardLimit);
      expect(result).toBe(MemoryAction.SoftRecycle);
    });

    it('should return None when heapSize is 0 (heap stats report no usage)', () => {
      const result = evaluateMemoryAction(makeStats(300, 0, 100), softLimit, hardLimit);
      expect(result).toBe(MemoryAction.None);
    });
  });

  describe('edge cases', () => {
    it('should return None when soft and hard limits are 0', () => {
      const result = evaluateMemoryAction(makeStats(300), 0, 0);
      expect(result).toBe(MemoryAction.None);
    });

    it('should handle stats with heapSize but no heapCapacity', () => {
      const result = evaluateMemoryAction(makeStats(300, 250, undefined), softLimit, hardLimit);
      expect(result).toBe(MemoryAction.SoftRecycle);
    });
  });
});
