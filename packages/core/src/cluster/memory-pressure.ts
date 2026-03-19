import type { ClusterWorkerStats } from './interfaces';

/**
 * Action to take based on memory pressure evaluation.
 *
 * @public
 */
export enum MemoryAction {
  /** Memory within acceptable bounds. No action. */
  None = 'None',
  /** RSS at or above soft limit. Graceful worker recycle. */
  SoftRecycle = 'SoftRecycle',
  /** RSS at or above hard limit. Immediate crash treatment. */
  HardCrash = 'HardCrash',
}

/**
 * Evaluates memory pressure for a single worker and returns the action to take.
 *
 * Decision logic:
 * 1. Limits <= 0 → disabled, return None.
 * 2. RSS >= hardLimit → HardCrash (always, regardless of heap).
 * 3. RSS >= softLimit:
 *    - If heapSize is available and below softLimit → None (RSS inflated by non-heap memory).
 *    - Otherwise → SoftRecycle (genuine memory pressure).
 * 4. RSS < softLimit → None.
 *
 * @param stats - Worker stats from getStats() RPC.
 * @param softLimit - Jittered per-worker soft memory limit in bytes.
 * @param hardLimit - Jittered per-worker hard memory limit in bytes.
 * @returns The memory action to take.
 * @public
 */
export function evaluateMemoryAction(
  stats: ClusterWorkerStats,
  softLimit: number,
  hardLimit: number,
): MemoryAction {
  if (softLimit <= 0 || hardLimit <= 0) {
    return MemoryAction.None;
  }

  if (stats.memory >= hardLimit) {
    return MemoryAction.HardCrash;
  }

  if (stats.memory >= softLimit) {
    // If heap stats are available, check whether the JS heap itself is pressured.
    // If heapSize is well below the soft limit, RSS is likely inflated by
    // non-heap memory (mmap, file cache) — skip recycle to avoid false positives.
    if (stats.heapSize !== undefined && stats.heapSize < softLimit) {
      return MemoryAction.None;
    }

    return MemoryAction.SoftRecycle;
  }

  return MemoryAction.None;
}
