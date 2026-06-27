import { AsyncLocalStorage } from 'node:async_hooks';

import type { LogContext } from './interfaces';

export class RequestContext {
  private static storage = new AsyncLocalStorage<LogContext>();

  static run<R>(context: LogContext, callback: () => R): R {
    const parent = this.storage.getStore();
    const merged = parent ? { ...parent, ...context } : context;

    return this.storage.run(merged, callback);
  }

  static getContext(): LogContext | undefined {
    return this.storage.getStore();
  }

  static getRequestId(): string | undefined {
    return this.storage.getStore()?.reqId as string | undefined;
  }
}
