import { AsyncLocalStorage } from 'node:async_hooks';

import type { RequestContextData } from './interfaces';

/**
 * The single AsyncLocalStorage frame backing {@link RequestContext}. Module
 * private — propagation only works within one ALS instance, so this package
 * must resolve to a single copy across the dependency tree (peer dependency).
 */
const storage = new AsyncLocalStorage<RequestContextData>();

/**
 * Request-scoped context backed by a single AsyncLocalStorage frame.
 *
 * One shared store: producers (e.g. an adapter at the request boundary) write
 * via {@link RequestContext.run}, consumers (e.g. logger correlation) read via
 * {@link RequestContext.get}.
 *
 * Exposed as a plain object rather than a static-only class so it carries no
 * never-instantiated, structurally uncoverable constructor.
 */
export const RequestContext = {
  /** Run `callback` within a request scope, merging `data` over any parent frame. */
  run<R>(data: RequestContextData, callback: () => R): R {
    const parent = storage.getStore();
    const merged = parent ? { ...parent, ...data } : data;

    return storage.run(merged, callback);
  },

  /** Current request-scoped data, or `undefined` outside any scope. */
  get(): RequestContextData | undefined {
    return storage.getStore();
  },

  /** Convenience reader for the well-known `reqId`. */
  getRequestId(): string | undefined {
    return storage.getStore()?.reqId;
  },
} as const;
