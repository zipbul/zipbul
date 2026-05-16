import type { AdapterClass } from '@zipbul/common';

import type { WorkerState } from './enums';
import type { Promisified, RpcArgs, RpcCallable, RpcResult } from './types';

// ── Cluster Options ──────────────────────────────────────────

export interface ClusterOptions {
  script: URL;
  size: number;
  manifestPath?: string;
}

// ── Worker Slot ──────────────────────────────────────────────

/**
 * Complete per-worker state container.
 *
 * Every field that external features (health check, rolling restart,
 * recycling, memory pressure) read or write lives here.
 *
 *
 * @public
 */
export interface ClusterWorkerSlot<T extends Record<string, RpcCallable>> {
  readonly id: number;
  state: WorkerState;

  /** Monotonically increasing. Incremented on Crashed entry. Used by all event handlers to discard stale events. */
  generation: number;
  /** Set on Destroying entry. Close handler checks this: true → Terminated, false → Crashed. */
  terminateInitiated: boolean;
  /** Set when { type: 'ready' } received. Prevents startup timeout from killing a ready worker. */
  readyReceived: boolean;

  native: Worker | undefined;
  remote: Promisified<T> | undefined;
  rpcProxy: RpcProxy<T> | undefined;

  /** Named event listeners for deterministic cleanup. */
  handlers: Map<string, EventListener>;
  /** Active timers (startup, drain, RPC, backoff, destroy). Cleared on every state transition. */
  timers: Set<ReturnType<typeof setTimeout>>;

  /** Per-worker startup timeout timer reference. */
  startupTimer: ReturnType<typeof setTimeout> | undefined;
  /** Whether a health check RPC is currently in-flight. Prevents back-pressure false positives. */
  healthCheckPending: boolean;
  /** Jittered soft memory threshold for this worker (bytes). */
  softMemoryLimit: number;
  /** Jittered hard memory threshold for this worker (bytes). */
  hardMemoryLimit: number;

  reviveAttempts: number;
  firstCrashTime: number | undefined;
  lastCrashTime: number | undefined;
  lastReadyTime: number | undefined;
  lastStats: ClusterWorkerStats | undefined;
  healthCheckFailures: number;
}

// ── RPC ──────────────────────────────────────────────────────

/**
 * Wraps a Promisified RPC proxy with a dispose method
 * that rejects all pending calls and removes event listeners.
 *
 *
 * @public
 */
export interface RpcProxy<T extends Record<string, RpcCallable>> {
  api: Promisified<T>;
  dispose(): void;
}

export interface ClusterWorkerStats {
  cpu: number;
  memory: number;
  /** JS heap size in bytes (from bun:jsc heapStats). */
  heapSize?: number;
  /** JS heap capacity in bytes (from bun:jsc heapStats). */
  heapCapacity?: number;
}

export interface RPCMessage {
  id: string;
  method: string;
  args: RpcArgs;
}

/**
 * RPC response with structured error serialization (message + stack + name).
 *
 *
 * @public
 */
export interface RPCResponse {
  id: string;
  result?: RpcResult;
  error?: RPCErrorPayload;
}

export interface RPCErrorPayload {
  message: string;
  stack?: string;
  name: string;
}

export interface RpcPending {
  resolve(value: RpcResult): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

// ── Worker Group ─────────────────────────────────────────────

/**
 * User-facing worker group configuration for explicit adapter assignment.
 *
 *
 * @public
 */
export interface WorkerGroupConfig {
  /** Adapter classes assigned to this group. */
  readonly adapters: readonly AdapterClass[];
  /** Worker count. Omitted → Exclusive=1, Shared=hardwareConcurrency. */
  readonly workers?: number;
}

/**
 * Per-group circuit breaker state.
 *
 *
 */
export interface GroupCircuitBreaker {
  crashTimestamps: number[];
  maxIntensity: number;
  periodMs: number;
  tripped: boolean;
}
