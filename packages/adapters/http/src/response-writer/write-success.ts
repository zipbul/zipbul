import type { HttpResponse } from '../http-response';
import type { RouteHandlerResult, ResponseBodyValue } from '../types';

/**
 * Serializes a BUFFERED handler result onto the HTTP response.
 *
 * Streaming results (`AsyncIterable` → SSE / raw byte stream) are deliberately
 * NOT handled here: a stream is consumed lazily by the server long after the
 * request pipeline finished, and a throw during consumption must be logged via
 * the adapter's own logger. That makes streaming an adapter-owned, stateful
 * concern — see `HttpAdapter.writeStreamingResponse`. This function stays a
 * pure, adapter/logger-agnostic serializer for already-materialized values, so
 * the caller (the WriteResponse step) routes streams away before calling it.
 */
export function writeSuccessResponse(res: HttpResponse, result: RouteHandlerResult): void {
  // Native Response passthrough (handler-created Response)
  if (result instanceof Response) {
    res.setNativeResponse(result);
    return;
  }

  if (result === undefined || result === null) {
    return;
  }

  if (typeof result === 'bigint') {
    res.setBody(result.toString());
    return;
  }

  res.setBody(result as ResponseBodyValue);
}
