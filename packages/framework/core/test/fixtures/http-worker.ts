/**
 * HTTP worker script for cluster E2E tests.
 *
 * Starts Bun.serve with reusePort on the port specified via init params.
 * Returns the worker ID in the response body for load distribution verification.
 */
import { exposeWorker } from '../../src/cluster/rpc-expose';
import type { RpcCallable, RpcArgs } from '../../src/cluster/types';
import type { ZipbulValue } from '@zipbul/common';

let workerId = -1;
let server: ReturnType<typeof Bun.serve> | undefined;

function isRecord(value: unknown): value is Record<string, ZipbulValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const init: RpcCallable = async (...args: RpcArgs) => {
  workerId = typeof args[0] === 'number' ? args[0] : 0;
  const params = args.length > 1 && isRecord(args[1]) ? args[1] : {};
  const port = typeof params.port === 'number' ? params.port : 0;
  const crashAfterMs = typeof params.crashAfterMs === 'number' ? params.crashAfterMs : undefined;
  const crashWorkerId = typeof params.crashWorkerId === 'number' ? params.crashWorkerId : undefined;

  server = Bun.serve({
    port,
    reusePort: true,
    fetch() {
      return new Response(JSON.stringify({ workerId }), {
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  if (crashAfterMs !== undefined && (crashWorkerId === undefined || crashWorkerId === workerId)) {
    setTimeout(() => process.exit(1), crashAfterMs);
  }

  return null;
};

const bootstrap: RpcCallable = () => null;

const destroy: RpcCallable = () => {
  void server?.stop(true);
  server = undefined;

  return null;
};

const getStats: RpcCallable = () => ({
  cpu: 0,
  memory: process.memoryUsage.rss(),
});

const getStatsAfterGC: RpcCallable = () => ({
  cpu: 0,
  memory: process.memoryUsage.rss(),
});

exposeWorker(
  { init, bootstrap, destroy, getStats, getStatsAfterGC },
  ['init', 'bootstrap', 'destroy', 'getStats', 'getStatsAfterGC'],
);
