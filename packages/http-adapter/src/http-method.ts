/**
 * Standard HTTP methods supported by the framework (RFC 9110 §9.3).
 * Used as the base set for `allowedMethods`; custom methods are
 * appended via `HttpServerOptions.customMethods` at boot time.
 *
 * TRACE and CONNECT return 501 Not Implemented when no handler is
 * registered (RFC 9110 §9.3.6/§9.3.8 SHOULD).
 */
export const HTTP_STANDARD_METHODS: ReadonlySet<string> = new Set<string>([
  'GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'CONNECT', 'TRACE',
]);
