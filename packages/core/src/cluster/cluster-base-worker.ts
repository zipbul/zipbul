import { heapStats, edenGC, fullGC } from 'bun:jsc';
import type { ClusterWorkerStats } from './interfaces';
import type { ClusterBootstrapParams, ClusterInitParams, ClusterWorkerId } from './types';

export abstract class ClusterBaseWorker {
  protected prevCpu: ReturnType<typeof process.cpuUsage>;
  protected prevTime: bigint;
  protected id: ClusterWorkerId;

  abstract bootstrap<T>(params?: ClusterBootstrapParams<T>): void | Promise<void>;

  abstract destroy(): void | Promise<void>;

  async init<T>(id: number, _params: ClusterInitParams<T>) {
    this.id = id;
    this.prevCpu = process.cpuUsage();
    this.prevTime = process.hrtime.bigint();

    await Promise.resolve();
  }

  /**
   * Returns CPU usage ratio (0–1) relative to wall-clock time elapsed
   * since the previous call, and current RSS in bytes.
   *
   * @returns Worker stats for health check and memory pressure evaluation.
   * @public
   */
  getStats(): ClusterWorkerStats {
    const now = process.hrtime.bigint();
    const elapsedSeconds = Number(now - this.prevTime) / 1_000_000_000;

    const currentCpu = process.cpuUsage(this.prevCpu);
    const cpuSeconds = (currentCpu.user + currentCpu.system) / 1_000_000;

    this.prevCpu = process.cpuUsage();
    this.prevTime = now;

    const heap = heapStats();

    return {
      cpu: elapsedSeconds > 0 ? Math.min(1, cpuSeconds / elapsedSeconds) : 0,
      memory: process.memoryUsage.rss(),
      heapSize: heap.heapSize,
      heapCapacity: heap.heapCapacity,
    };
  }

  /**
   * Triggers a young-generation GC (eden collection) then returns fresh stats.
   *
   * Used by the master process when soft memory limit is reached:
   * if post-GC stats drop below the limit, the recycle is skipped.
   *
   * @returns Worker stats collected after GC.
   * @public
   */
  getStatsAfterGC(): ClusterWorkerStats {
    edenGC();
    fullGC();

    return this.getStats();
  }
}
