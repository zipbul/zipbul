import type { Class, CompiledHandlerEntry, MiddlewareDefinition, ProviderToken, ExceptionFilterDefinition } from '@zipbul/common';
import type { MiddlewareHook } from '@zipbul/common';
import type { GuardDefinition } from '@zipbul/common';

import type { Container } from '../injector/container';
import type { ClassMetadata } from '../injector/types';

/**
 * Per-adapter configuration produced by AOT.
 *
 * @public
 */
export interface AdapterMiddlewareConfig {
  middlewares?: Partial<Record<MiddlewareHook, readonly MiddlewareDefinition[]>>;
  exceptionFilters?: readonly ExceptionFilterDefinition[];
  guards?: readonly GuardDefinition[];
}

export interface RuntimeContext {
  metadataRegistry?: Map<Class, ClassMetadata>;
  scopedKeys?: Map<ProviderToken, string>;
  container?: Container;
  isAotRuntime?: boolean;
  adapterConfig?: Record<string, AdapterMiddlewareConfig>;
  handlerIndex?: readonly CompiledHandlerEntry[];
  controllerInstances?: Map<string, unknown>;
}
