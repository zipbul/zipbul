import type { Class, CompiledHandlerEntry, MiddlewareDefinition, ProviderToken, ExceptionFilterEntry } from '@zipbul/common';
import type { MiddlewareHook } from '@zipbul/common';

import type { Container } from '../injector/container';
import type { ClassMetadata } from '../injector/types';

/**
 * Per-adapter configuration produced by AOT.
 *
 * @public
 */
export interface AdapterMiddlewareConfig {
  middlewares?: Partial<Record<MiddlewareHook, readonly MiddlewareDefinition[]>>;
  errorFilters?: readonly ExceptionFilterEntry[];
}

export interface RuntimeContext {
  metadataRegistry?: Map<Class, ClassMetadata>;
  scopedKeys?: Map<ProviderToken, string>;
  container?: Container;
  isAotRuntime?: boolean;
  adapterConfig?: Record<string, AdapterMiddlewareConfig>;
  handlerIndex?: readonly CompiledHandlerEntry[];
}
