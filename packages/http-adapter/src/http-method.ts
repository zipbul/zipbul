import type { HttpMethod } from '@zipbul/shared';

/**
 * Standard HTTP methods supported by the framework.
 * Used for runtime validation before routing.
 */
export const HTTP_STANDARD_METHODS: ReadonlySet<string> = new Set<string>([
  'GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS',
]);

/**
 * Checks if a string is a standard HTTP method.
 *
 * @param value - Uppercase HTTP method string.
 * @returns True if the value is one of the 7 standard HTTP methods.
 * @public
 */
export function isHttpMethod(value: string): value is HttpMethod {
  return HTTP_STANDARD_METHODS.has(value);
}
