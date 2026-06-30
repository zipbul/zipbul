import { AsyncLocalStorage } from 'node:async_hooks';

import type { RequestContextData } from './interfaces';

/**
 * Request-scoped context backed by a single AsyncLocalStorage frame.
 *
 * One shared store: producers (e.g. an adapter at the request boundary) write
 * via {@link run}, consumers (e.g. logger correlation) read via {@link get}.
 * Because propagation only works within the same ALS instance, this package
 * must resolve to a single copy across the dependency tree (peer dependency).
 */
export class RequestContext {
  private static readonly storage = new AsyncLocalStorage<RequestContextData>();

  /** Run `callback` within a request scope, merging `data` over any parent frame. */
  static run<R>(data: RequestContextData, callback: () => R): R {
    const parent = RequestContext.storage.getStore();
    const merged = parent ? { ...parent, ...data } : data;

    return RequestContext.storage.run(merged, callback);
  }

  /** Current request-scoped data, or `undefined` outside any scope. */
  static get(): RequestContextData | undefined {
    return RequestContext.storage.getStore();
  }

  /** Convenience reader for the well-known `reqId`. */
  static getRequestId(): string | undefined {
    return RequestContext.storage.getStore()?.reqId;
  }
}
