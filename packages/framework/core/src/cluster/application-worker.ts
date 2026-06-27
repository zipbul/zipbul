import type { ZipbulRecord, ZipbulValue } from '@zipbul/common';

import { ClusterBaseWorker } from './cluster-base-worker';
import { registerBootstrapState } from '../runtime/bootstrap-state';
import type { RpcArgs, RpcCallable } from './types';
import { exposeWorker } from './rpc-expose';

const RPC_METHODS = ['init', 'bootstrap', 'destroy', 'getStats', 'getStatsAfterGC'] as const;

/**
 * Adapter-agnostic worker that loads the AOT runtime and boots
 * the full Application with only the adapters assigned to its group.
 *
 * The AOT runtime is loaded via `preload` option (set by ClusterManager),
 * which triggers `registerBootstrapState()` before this script executes.
 * The user's app module is then dynamically imported, calling
 * `createApplication()` → `attach()` → `start()` internally.
 *
 * `Application.start()` detects the worker context via `getBootstrapState().workerId`
 * and filters adapters based on `getBootstrapState().adapterFilter`.
 *
 * @public
 */
class ApplicationWorker extends ClusterBaseWorker {
  override async init(workerId: number, params: Parameters<ClusterBaseWorker['init']>[1], adapterFilter?: ZipbulValue) {
    await super.init(workerId, params);

    // Register worker context so Application.start() can detect worker mode
    // and filter adapters without relying on environment variables.
    const parsedFilter = parseAdapterFilter(adapterFilter);
    const workerContext = parsedFilter !== undefined
      ? { workerId, adapterFilter: parsedFilter }
      : { workerId };

    registerBootstrapState(workerContext);

    if (!isRecord(params)) {
      throw new Error('ApplicationWorker requires init params with appEntryPath');
    }

    const appEntryPath = params.appEntryPath;

    if (typeof appEntryPath !== 'string' || appEntryPath.length === 0) {
      throw new Error('ApplicationWorker requires appEntryPath in init params');
    }

    // Import the app entry module — this triggers createApplication() → start()
    // Application.start() will detect worker mode and start only assigned adapters
    await import(appEntryPath);
  }

  bootstrap() {
    // Application is already started during init via the imported entry module
  }

  async destroy() {
    // Application.stop() is called by the process exit handler or
    // will be invoked via the global application reference
  }
}

// ── Module-level RPC setup (no top-level await) ────────────

const worker = new ApplicationWorker();

const initRpc: RpcCallable = async (...args: RpcArgs) => {
  const workerId = typeof args[0] === 'number' ? args[0] : 0;
  const params = args.length > 1 && isRecord(args[1]) ? args[1] : undefined;
  const adapterFilter = args.length > 2 ? args[2] : undefined;

  await worker.init(workerId, params, adapterFilter);

  return null;
};

const bootstrapRpc: RpcCallable = () => {
  worker.bootstrap();

  return null;
};

const destroyRpc: RpcCallable = async () => {
  await worker.destroy();

  return null;
};

const getStatsRpc: RpcCallable = () => {
  return worker.getStats();
};

const getStatsAfterGCRpc: RpcCallable = () => {
  return worker.getStatsAfterGC();
};

exposeWorker(
  { init: initRpc, bootstrap: bootstrapRpc, destroy: destroyRpc, getStats: getStatsRpc, getStatsAfterGC: getStatsAfterGCRpc },
  RPC_METHODS,
);

function isRecord(value: unknown): value is ZipbulRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseAdapterFilter(value: ZipbulValue | undefined): readonly string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');

  return undefined;
}

export { ApplicationWorker };
