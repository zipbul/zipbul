import type { Class, MiddlewareDefinition, ProviderToken } from '@zipbul/common';
import type { MiddlewareHook } from '@zipbul/common';

import type { Container } from '../injector/container';
import type { ClassMetadata } from '../injector/types';

/**
 * Per-adapter middleware configuration produced by AOT.
 *
 * @public
 */
export interface AdapterMiddlewareConfig {
  middlewares?: Partial<Record<MiddlewareHook, readonly MiddlewareDefinition[]>>;
}

export interface RuntimeContext {
  metadataRegistry?: Map<Class, ClassMetadata>;
  scopedKeys?: Map<ProviderToken, string>;
  container?: Container;
  isAotRuntime?: boolean;
  adapterConfig?: Record<string, AdapterMiddlewareConfig>;
}
