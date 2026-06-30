/**
 * Request-scoped data carried through the AsyncLocalStorage frame.
 *
 * Open record — callers attach whatever request-correlation fields they need
 * (e.g. `reqId`, `userId`). `reqId` is the one well-known key that
 * {@link RequestContext.getRequestId} reads.
 */
export interface RequestContextData {
  reqId?: string;
  [key: string]: unknown;
}
