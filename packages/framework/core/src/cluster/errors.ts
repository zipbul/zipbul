/**
 * Thrown when an RPC call does not receive a response within the configured timeout.
 *
 * @public
 */
export class RpcTimeoutError extends Error {
  readonly method: string;
  readonly timeoutMs: number;

  constructor(method: string, timeoutMs: number) {
    super(`RPC call "${method}" timed out after ${timeoutMs}ms`);
    this.name = 'RpcTimeoutError';
    this.method = method;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Thrown when pending RPC calls are rejected due to worker termination or disposal.
 *
 * @public
 */
export class RpcAbortedError extends Error {
  constructor(reason: string) {
    super(`RPC aborted: ${reason}`);
    this.name = 'RpcAbortedError';
  }
}

/**
 * Thrown when a worker fails to reach Running state within the startup timeout.
 *
 * @public
 */
export class WorkerStartupTimeoutError extends Error {
  readonly workerId: number;
  readonly timeoutMs: number;

  constructor(workerId: number, timeoutMs: number) {
    super(`Worker #${workerId} failed to start within ${timeoutMs}ms`);
    this.name = 'WorkerStartupTimeoutError';
    this.workerId = workerId;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Thrown when a state transition is attempted that is not in the valid transition table.
 *
 * @public
 */
export class InvalidStateTransitionError extends Error {
  readonly from: string;
  readonly to: string;

  constructor(workerId: number, from: string, to: string) {
    super(`Worker #${workerId}: invalid state transition ${from} → ${to}`);
    this.name = 'InvalidStateTransitionError';
    this.from = from;
    this.to = to;
  }
}
