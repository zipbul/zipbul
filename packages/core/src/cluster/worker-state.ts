import { Logger } from '@zipbul/logger';

import { WorkerState } from './enums';
import { InvalidStateTransitionError } from './errors';
import type { ClusterWorkerSlot } from './interfaces';
import type { RpcCallable } from './types';

const logger = new Logger('WorkerState');

/**
 * Valid state transitions.
 *
 * The key is the source state. The value is the set of allowed target states.
 * Any transition not in this table is rejected by `transition()`.
 *
 *
 */
const VALID_TRANSITIONS: ReadonlyMap<WorkerState, ReadonlySet<WorkerState>> = new Map([
  [WorkerState.Spawning, new Set([
    WorkerState.Ready,
    WorkerState.Crashed,
    WorkerState.Terminated,
  ])],
  [WorkerState.Ready, new Set([
    WorkerState.Initializing,
    WorkerState.Crashed,
    WorkerState.Terminated,
  ])],
  [WorkerState.Initializing, new Set([
    WorkerState.Running,
    WorkerState.Crashed,
    WorkerState.Terminated,
  ])],
  [WorkerState.Running, new Set([
    WorkerState.Draining,
    WorkerState.Crashed,
  ])],
  [WorkerState.Draining, new Set([
    WorkerState.Destroying,
    WorkerState.Crashed,
  ])],
  [WorkerState.Destroying, new Set([
    WorkerState.Terminated,
    WorkerState.Crashed,
  ])],
  [WorkerState.Crashed, new Set([
    WorkerState.Reviving,
    WorkerState.Terminated,
  ])],
  [WorkerState.Reviving, new Set([
    WorkerState.Spawning,
    WorkerState.Terminated,
  ])],
  // Terminated has no valid transitions — it is the terminal absorbing state.
]);

/**
 * Central state transition function.
 *
 * All state changes MUST go through this function (Invariant A).
 * Rejects invalid transitions and clears timers from the previous state.
 *
 * @param slot - The worker slot to transition.
 * @param from - Expected current state. If `slot.state !== from`, the transition is rejected.
 * @param to - Target state.
 * @returns `true` if the transition was applied, `false` if rejected.
 *
 *
 * @public
 */
export function transition<T extends Record<string, RpcCallable>>(
  slot: ClusterWorkerSlot<T>,
  from: WorkerState,
  to: WorkerState,
): boolean {
  if (slot.state !== from) {
    logger.debug(`Worker #${slot.id} transition rejected: expected ${from}, actual ${slot.state} (target was ${to})`);

    return false;
  }

  const allowed = VALID_TRANSITIONS.get(from);

  if (!allowed || !allowed.has(to)) {
    logger.error(`Worker #${slot.id} invalid transition: ${from} → ${to}`);

    throw new InvalidStateTransitionError(slot.id, from, to);
  }

  clearSlotTimers(slot);

  slot.state = to;

  logger.debug(`Worker #${slot.id} [gen=${slot.generation}]: ${from} → ${to}`);

  return true;
}

/**
 * Clears all active timers on a slot.
 *
 * Called on every state transition to prevent stale timer callbacks
 * from firing in a state they were not intended for.
 */
function clearSlotTimers<T extends Record<string, RpcCallable>>(slot: ClusterWorkerSlot<T>): void {
  for (const timer of slot.timers) {
    clearTimeout(timer);
  }

  slot.timers.clear();

  if (slot.startupTimer !== undefined) {
    clearTimeout(slot.startupTimer);
    slot.startupTimer = undefined;
  }
}

/**
 * Creates a fresh slot with all fields initialized to defaults.
 *
 * @param id - Worker slot index.
 * @returns A new ClusterWorkerSlot in Spawning state.
 * @public
 */
export function createSlot<T extends Record<string, RpcCallable>>(id: number): ClusterWorkerSlot<T> {
  return {
    id,
    state: WorkerState.Spawning,
    generation: 0,
    terminateInitiated: false,
    readyReceived: false,

    native: undefined,
    remote: undefined,
    rpcProxy: undefined,

    handlers: new Map(),
    timers: new Set(),

    startupTimer: undefined,
    healthCheckPending: false,
    softMemoryLimit: 0,
    hardMemoryLimit: 0,

    reviveAttempts: 0,
    firstCrashTime: undefined,
    lastCrashTime: undefined,
    lastReadyTime: undefined,
    lastStats: undefined,
    healthCheckFailures: 0,
  };
}

/**
 * Disposes all resources held by a slot.
 *
 * Removes event listeners, clears timers, rejects pending RPC,
 * and nulls references.
 *
 *
 * @public
 */
export function disposeSlot<T extends Record<string, RpcCallable>>(slot: ClusterWorkerSlot<T>): void {
  for (const [event, handler] of slot.handlers) {
    slot.native?.removeEventListener(event, handler);
  }

  slot.handlers.clear();

  clearSlotTimers(slot);

  slot.rpcProxy?.dispose();

  slot.native = undefined;
  slot.remote = undefined;
  slot.rpcProxy = undefined;
}
