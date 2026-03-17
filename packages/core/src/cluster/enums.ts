/**
 * Worker lifecycle states.
 *
 *
 * @public
 */
export enum WorkerState {
  /** Worker object created, native Worker not yet spawned. */
  Spawning = 'Spawning',
  /** "open" event received — Worker thread is running, ready to receive messages. */
  Ready = 'Ready',
  /** init RPC sent, waiting for init+bootstrap completion. */
  Initializing = 'Initializing',
  /** init+bootstrap complete, worker sent ready message. Serving traffic. */
  Running = 'Running',
  /** drain RPC sent — finishing in-flight work, rejecting new connections. */
  Draining = 'Draining',
  /** terminate() called — awaiting close event or terminate timeout. */
  Destroying = 'Destroying',
  /** Terminal state. Worker is dead, slot can be reused. */
  Terminated = 'Terminated',
  /** Unexpected error/close event received. Pending recovery decision. */
  Crashed = 'Crashed',
  /** Backoff timer running, waiting to respawn. */
  Reviving = 'Reviving',
}

/**
 * Adapter clustering strategy.
 *
 * Declared on the Adapter base class. Determines how the framework
 * assigns adapters to worker groups in cluster mode.
 *
 *
 * @public
 */
export enum ClusterStrategy {
  /**
   * Port sharing via reusePort for horizontal scaling.
   * N workers run identical adapter instances. Kernel distributes traffic.
   *
   * @example HTTP, gRPC Unary, MQ Consumer
   */
  Shared = 'Shared',

  /**
   * Exactly 1 worker runs this adapter.
   * Duplicate execution causes side effects.
   *
   * @example Cron, Leader Election, Scheduler
   */
  Exclusive = 'Exclusive',
}
