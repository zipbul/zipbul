import type {
  AdapterClass,
  Class,
  ExceptionFilterDefinition,
  GuardDefinition,
  MiddlewareDefinition,
} from '@zipbul/common';

/**
 * Declarative per-adapter configuration inside `defineModule({ adapters })`.
 *
 * `adapter` identifies the transport class; the remaining fields mirror the
 * AOT-applied adapter config — phase-keyed middleware plus optional guards and
 * exception filters — and are applied at bootstrap via the adapter's
 * `applyMiddlewareConfig` / `applyGuardConfig` / `applyExceptionFilterConfig`.
 *
 * Middleware phase keys are the adapter's phase string values
 * (e.g. `'OnRequest'`), not the phase enum members.
 */
export interface AdapterModuleConfig {
  adapter: AdapterClass;
  middlewares?: Readonly<Record<string, readonly MiddlewareDefinition[]>>;
  guards?: readonly GuardDefinition[];
  exceptionFilters?: readonly ExceptionFilterDefinition[];
}

/**
 * Options accepted by {@link defineModule}.
 *
 * `defineModule` is a build-time marker resolved by the AOT compiler; this
 * shape exists for authoring DX and type-checking and is not read at runtime.
 */
export interface DefineModuleOptions {
  name?: string;
  providers?: readonly Class[];
  adapters?: readonly AdapterModuleConfig[];
}
