import { AsyncLocalStorage } from 'node:async_hooks';

import type { AdapterContext } from '@zipbul/common';

const adapterContextStore = new AsyncLocalStorage<AdapterContext>();

/**
 * Returns the current adapter context from `AsyncLocalStorage`.
 * Must be called within a request lifecycle (inside `dispatchRequest`).
 *
 * Returns the base `AdapterContext` — use `ctx.to(HttpContext)` to narrow
 * to a protocol-specific context type.
 *
 * @returns The current adapter context.
 * @throws Error if called outside a request lifecycle.
 *
 * @example
 * ```typescript
 * const ctx = getAdapterContext();
 * const http = ctx.to(HttpContext);
 * ```
 *
 * @public
 */
export function getAdapterContext(): AdapterContext {
  const ctx = adapterContextStore.getStore();
  if (!ctx) throw new Error('getAdapterContext() must be called within a request.');
  return ctx;
}

/**
 * Wraps a callback in an `AsyncLocalStorage` context so that
 * `getAdapterContext()` returns the given context throughout the entire
 * async call tree.
 *
 * Called by `Adapter.dispatchRequest()` — all adapters automatically
 * enable `getAdapterContext()` for every request.
 *
 * @param ctx - The adapter context to make available.
 * @param fn - The callback to execute within the context.
 * @returns The return value of `fn`.
 *
 * @public
 */
export function runInAdapterContext<T>(ctx: AdapterContext, fn: () => T): T {
  return adapterContextStore.run(ctx, fn);
}
