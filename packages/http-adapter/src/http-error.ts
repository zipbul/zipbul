import { err, type Err } from '@zipbul/result';
import { getReasonPhrase } from 'http-status-codes';

import type { ErrorResponseData, HttpStatus, JsonValue } from './types';

/**
 * RFC 9110 §15 reason phrase updates. The `http-status-codes` package still
 * ships RFC 2616 phrases for a few codes; callers rely on the current RFC
 * spelling. Any entry here wins over the package's default.
 */
const RFC_9110_PHRASE_OVERRIDES: Readonly<Record<number, string>> = {
  413: 'Content Too Large',
  414: 'URI Too Long',
  416: 'Range Not Satisfiable',
  422: 'Unprocessable Content',
};

/**
 * Creates an `Err<ErrorResponseData>` for an HTTP response error.
 *
 * The framework routes request-level failures as `Result` values — never as
 * thrown exceptions. Use this helper anywhere a handler, guard, middleware,
 * or body parser needs to signal an HTTP error response. The `message`
 * argument defaults to the RFC reason phrase for the given status code.
 *
 * ### When to use
 * - **Always** for request-level failures (400, 401, 403, 404, 405, 413,
 *   414, 415, 422, 500 ... anything the HTTP spec anticipates).
 *
 * ### When NOT to use
 * - Invariants, programmer errors, boot-time misconfiguration — these
 *   should `throw new Error(...)`. The framework's dispatcher catches
 *   uncaught throws and converts them to a generic 500 by design.
 *
 * @example
 * if (!user) return httpError(StatusCodes.NOT_FOUND);
 * if (!body) return httpError(StatusCodes.BAD_REQUEST, 'Empty body');
 * return httpError(StatusCodes.UNPROCESSABLE_ENTITY, 'Validation failed', issues);
 */
export function httpError(
  status: HttpStatus,
  message?: string,
  errors?: readonly JsonValue[],
): Err<ErrorResponseData> {
  return err({
    status,
    message: message ?? RFC_9110_PHRASE_OVERRIDES[status] ?? getReasonPhrase(status),
    ...(errors !== undefined ? { errors } : {}),
  });
}
