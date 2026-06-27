import { HTTP_STATUS_REASON } from '../constants';
import type { HttpStatus } from '../enums/http-status';

/**
 * Returns the IANA-registered reason phrase for a {@link HttpStatus} code.
 *
 * Callers can rely on the returned `string` type without nullish handling.
 *
 * @param status - The HTTP status code.
 * @returns The reason phrase, or an empty string for unregistered codes.
 */
export function reasonOf(status: HttpStatus): string {
  return HTTP_STATUS_REASON[status] ?? '';
}
