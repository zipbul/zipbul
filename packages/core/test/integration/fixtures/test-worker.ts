/**
 * Minimal worker script for ClusterManager integration tests.
 *
 * Exposes init, bootstrap, destroy, getStats via RPC.
 * Behavior is controlled by init params:
 *   - { crash: true }       → process.exit(1) after init
 *   - { hangInit: true }    → never resolves init
 *   - { slowInit: number }  → delays init by N ms
 *   - (default)             → normal init/bootstrap/destroy
 */
import { exposeWorker } from '../../../src/cluster/rpc-expose';
import type { RpcCallable, RpcArgs } from '../../../src/cluster/types';
import type { ZipbulValue } from '@zipbul/common';

interface WorkerState {
  initialized: boolean;
  workerId: number;
  initTime: bigint;
}

const state: WorkerState = {
  initialized: false,
  workerId: -1,
  initTime: process.hrtime.bigint(),
};

interface InitParams {
  crash?: boolean;
  hangInit?: boolean;
  slowInit?: number;
}

function isRecord(value: unknown): value is Record<string, ZipbulValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const init: RpcCallable = async (...args: RpcArgs) => {
  const workerId = typeof args[0] === 'number' ? args[0] : 0;
  const params = args.length > 1 && isRecord(args[1]) ? args[1] as unknown as InitParams : {};

  state.workerId = workerId;

  if (params.hangInit === true) {
    // Never resolve — simulates hung init for timeout testing
    await new Promise<void>(() => {});
  }

  if (typeof params.slowInit === 'number') {
    await new Promise<void>((resolve) => setTimeout(resolve, params.slowInit));
  }

  state.initialized = true;
  state.initTime = process.hrtime.bigint();

  if (params.crash === true) {
    process.exit(1);
  }

  return null;
};

const bootstrap: RpcCallable = () => {
  return null;
};

const destroy: RpcCallable = () => {
  return null;
};

const getStats: RpcCallable = () => {
  const now = process.hrtime.bigint();
  const elapsed = Number(now - state.initTime) / 1_000_000_000;

  return {
    cpu: elapsed > 0 ? 0.1 : 0,
    memory: process.memoryUsage.rss(),
  };
};

const getStatsAfterGC: RpcCallable = () => {
  // Trigger GC in the worker process before collecting stats
  const { edenGC, fullGC } = require('bun:jsc');
  edenGC();
  fullGC();

  return getStats();
};

exposeWorker(
  { init, bootstrap, destroy, getStats, getStatsAfterGC },
  ['init', 'bootstrap', 'destroy', 'getStats', 'getStatsAfterGC'],
);
