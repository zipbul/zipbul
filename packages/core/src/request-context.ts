import { AsyncLocalStorage } from 'node:async_hooks';

import type { Context } from '@zipbul/common';

const requestContextStore = new AsyncLocalStorage<Context>();

/**
 * Returns the current request's `Context` from `AsyncLocalStorage`.
 * Must be called within a request lifecycle (inside `dispatchRequest`).
 *
 * Returns the base `Context` — use `ctx.to(HttpContext)` to narrow
 * to a protocol-specific context type.
 *
 * @returns The current request context.
 * @throws Error if called outside a request lifecycle.
 *
 * @example
 * ```typescript
 * const ctx = getContext();
 * const http = ctx.to(HttpContext);
 * const cookies = http.get(Cookies);
 * ```
 *
 * @public
 */
export function getContext(): Context {
  const ctx = requestContextStore.getStore();
  if (!ctx) throw new Error('getContext() must be called within a request.');
  return ctx;
}

/**
 * Wraps a callback in an `AsyncLocalStorage` context so that
 * `getContext()` returns the given `Context` throughout the entire
 * async call tree.
 *
 * Called by `Adapter.dispatchRequest()` — all adapters automatically
 * enable `getContext()` for every request.
 *
 * @param ctx - The request context to make available.
 * @param fn - The callback to execute within the context.
 * @returns The return value of `fn`.
 *
 * @public
 */
export function runInRequestContext<T>(ctx: Context, fn: () => T): T {
  return requestContextStore.run(ctx, fn);
}
