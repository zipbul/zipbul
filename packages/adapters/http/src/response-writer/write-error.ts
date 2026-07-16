import type { HttpResponse } from '../http-response';
import type { ErrorResponseData } from '../interfaces';

import { ContentType } from '../enums';

/**
 * Writes a typed error value to the HTTP response.
 *
 * The framework routes request-level failures exclusively as
 * `Err<ErrorResponseData>`. Uncaught `throw` is handled separately by the
 * dispatcher's emergency teardown (generic 500) — this function expects
 * an already-typed payload.
 *
 * The error body is a different representation than whatever the success
 * path already produced — `replaceRepresentation` drops the prior
 * representation's metadata (ETag, Cache-Control, Content-Encoding, etc.) so
 * it doesn't ride along on the error response, while exchange headers (CORS,
 * Set-Cookie) survive. The Content-Type declaration is this writer's own —
 * it must win over any label a preceding step (e.g. `@ContentType`) left in
 * place, and it must be set independent of whatever label was there, since
 * serialization is decided by body type, not by a Content-Type label.
 */
export function writeErrorResponse(res: HttpResponse, err: ErrorResponseData): void {
  res.setStatus(err.status);
  res.setContentType(ContentType.Json);
  res.replaceRepresentation({
    status: err.status,
    message: err.message,
    ...(err.errors !== undefined ? { errors: [...err.errors] } : {}),
  });
}

