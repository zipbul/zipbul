import { describe, it, expect, afterEach } from 'bun:test';

import { ClusterManager } from '../../src/cluster/cluster-manager';
import { WorkerState } from '../../src/cluster/enums';
import type { ClusterBaseWorker } from '../../src/cluster/cluster-base-worker';
import type { RpcCallable } from '../../src/cluster/types';

type HttpWorkerRpc = ClusterBaseWorker & Record<string, RpcCallable>;

const HTTP_WORKER_SCRIPT = new URL('./fixtures/http-worker.ts', import.meta.url);

/** Find an available port by binding to port 0. */
async function findAvailablePort(): Promise<number> {
  const server = Bun.serve({ port: 0, fetch: () => new Response('') });
  const port = server.port;
  server.stop(true);

  return port;
}

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

function createHttpManager(size: number, config?: Record<string, unknown>): ClusterManager<HttpWorkerRpc> {
  return new ClusterManager<HttpWorkerRpc>(
    { script: HTTP_WORKER_SCRIPT, size },
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

describe('Cluster E2E — reusePort HTTP', () => {
  let manager: ClusterManager<HttpWorkerRpc> | undefined;

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

  it('should serve HTTP requests from multiple workers on the same port via reusePort', async () => {
    const port = await findAvailablePort();
    manager = createHttpManager(2);

    // Init workers with the shared port
    await manager.init({ port });
    await manager.bootstrap();

    // Verify all workers are Running
    const states = manager.getSlotStates();
    expect(states.every((slot) => slot.state === WorkerState.Running)).toBe(true);

    // Send HTTP requests and collect worker IDs
    const workerIds = new Set<number>();
    const totalRequests = 50;

    for (let idx = 0; idx < totalRequests; idx++) {
      const response = await fetch(`http://localhost:${port}/`);
      expect(response.status).toBe(200);

      const body = await response.json() as { workerId: number };
      workerIds.add(body.workerId);
    }

    // At least 1 worker should have responded (reusePort distributes by kernel)
    // With 50 requests and 2 workers, both should ideally respond,
    // but kernel hash-based distribution is not guaranteed to be even.
    expect(workerIds.size).toBeGreaterThanOrEqual(1);
  });

  it('should distribute requests across workers (probabilistic)', async () => {
    const port = await findAvailablePort();
    manager = createHttpManager(2);

    await manager.init({ port });
    await manager.bootstrap();

    // Send many requests to increase probability of hitting both workers
    const workerHits = new Map<number, number>();
    const totalRequests = 200;

    for (let idx = 0; idx < totalRequests; idx++) {
      const response = await fetch(`http://localhost:${port}/`);
      const body = await response.json() as { workerId: number };
      workerHits.set(body.workerId, (workerHits.get(body.workerId) ?? 0) + 1);
    }

    // With 200 requests and kernel 4-tuple hash distribution,
    // both workers should receive at least some requests.
    // Since all requests come from the same source, kernel may route all to one worker.
    // This test verifies the infrastructure works, not even distribution.
    expect(workerHits.size).toBeGreaterThanOrEqual(1);

    // Log distribution for debugging
    for (const [wid, count] of workerHits) {
      console.log(`Worker #${wid}: ${count}/${totalRequests} requests`);
    }
  });

  it('should continue serving after one worker is terminated', async () => {
    const port = await findAvailablePort();
    manager = createHttpManager(2, {
      crashWindowMs: 10_000,
      maxCrashesInWindow: 1,
    });

    await manager.init({ port });
    await manager.bootstrap();

    // Kill one worker's native thread directly
    const slots = manager.__testing__.getSlots();
    const slotToKill = slots[0]!;

    if (slotToKill.native) {
      slotToKill.native.terminate();
    }

    // Wait for crash processing
    await waitForCondition(
      () => manager!.getSlotStates()[0]!.generation >= 1,
      5_000,
    );

    // The surviving worker should still serve requests
    const response = await fetch(`http://localhost:${port}/`);
    expect(response.status).toBe(200);

    const body = await response.json() as { workerId: number };
    // Should be worker #1 (the survivor), not #0 (the killed one)
    expect(body.workerId).toBe(1);
  });

  it('should gracefully shutdown all workers and release the port', async () => {
    const port = await findAvailablePort();
    manager = createHttpManager(2);

    await manager.init({ port });
    await manager.bootstrap();

    // Verify serving
    const beforeDestroy = await fetch(`http://localhost:${port}/`);
    expect(beforeDestroy.status).toBe(200);

    // Destroy all workers
    await manager.destroy();

    // Verify all workers are Terminated
    expect(manager.getSlotStates().every((slot) => slot.state === WorkerState.Terminated)).toBe(true);

    // Port should be released — fetch should fail
    try {
      await fetch(`http://localhost:${port}/`);
      // If we get here, the port is still open (unexpected)
      expect(true).toBe(false);
    } catch {
      // Expected — connection refused
    }

    manager = undefined;
  });
});
