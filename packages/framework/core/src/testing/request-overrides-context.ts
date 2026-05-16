import { AsyncLocalStorage } from 'node:async_hooks';

import type { ProviderRegistration, Token } from '../injector/types';

/**
 * Per-request provider override map carried through an `AsyncLocalStorage`
 * frame. Adapters that build a request-scoped child container consult this
 * value via {@link currentRequestOverrides} and forward it to
 * `Container.createRequestScope(id, overrides)`.
 *
 * Used by `@zipbul/testing`'s adapter inject paths to inject per-request
 * stubs without changing the adapter's production `fetch` signature.
 *
 * @public
 */
export type RequestOverrideMap = ReadonlyMap<Token, ProviderRegistration>;

const requestOverridesStorage = new AsyncLocalStorage<RequestOverrideMap>();

/**
 * Runs `fn` inside an ALS frame carrying the given overrides. The frame
 * is propagated across awaits so any nested `createRequestScope` call site
 * sees the same map regardless of how deep the async chain runs.
 *
 * @public
 */
export function runWithRequestOverrides<T>(
  overrides: RequestOverrideMap,
  fn: () => Promise<T>,
): Promise<T> {
  return requestOverridesStorage.run(overrides, fn);
}

/**
 * Returns the current request override map, or `undefined` when no test
 * harness is active. Production code paths read this and pass through to
 * `createRequestScope` — when undefined, behavior is identical to today.
 *
 * @public
 */
export function currentRequestOverrides(): RequestOverrideMap | undefined {
  return requestOverridesStorage.getStore();
}
