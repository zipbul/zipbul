import type { HttpResponse } from '../http-response';
import type { ErrorResponseData } from '../types';

/**
 * Writes a typed error value to the HTTP response.
 *
 * The framework routes request-level failures exclusively as
 * `Err<ErrorResponseData>`. Uncaught `throw` is handled separately by the
 * dispatcher's emergency teardown (generic 500) — this function expects
 * an already-typed payload.
 */
export function writeErrorResponse(res: HttpResponse, err: ErrorResponseData): void {
  res.setStatus(err.status);
  res.setBody({
    status: err.status,
    message: err.message,
    ...(err.errors !== undefined ? { errors: [...err.errors] } : {}),
  });
}

