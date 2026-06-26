import type { Class, CompiledHandlerEntry, ProviderToken, AdapterConfig } from '@zipbul/common';

import type { Container } from '../injector/container';
import type { ClassMetadata } from '../injector/types';

export interface BootstrapState {
  metadataRegistry?: Map<Class, ClassMetadata> | undefined;
  scopedKeys?: Map<ProviderToken, string>;
  container?: Container;
  isAotRuntime?: boolean;
  adapterConfig?: Record<string, AdapterConfig>;
  handlerIndex?: readonly CompiledHandlerEntry[];
  /**
   * Lazy controller factories produced by the AOT runtime. Each entry maps
   * a scoped controller key (e.g. `'users::UsersController'`) to a thunk
   * that constructs the controller on first call, resolving its deps from
   * the bootstrap container at materialization time.
   *
   * Lazy resolution lets `@zipbul/testing` apply `container.replace(...)`
   * (or per-request overrides) BEFORE controllers are constructed so the
   * override actually reaches their constructor injections.
   */
  controllerFactories?: ReadonlyMap<string, () => unknown>;
  /** Worker ID assigned by ClusterManager. Present only in worker processes. */
  workerId?: number;
  /** Adapter class names this worker should start. Present only in worker processes. */
  adapterFilter?: readonly string[];
}
