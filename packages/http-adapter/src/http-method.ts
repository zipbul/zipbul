/**
 * Standard HTTP methods supported by the framework.
 * Used as the base set for `allowedMethods`; custom methods are
 * appended via `HttpServerOptions.customMethods` at boot time.
 */
export const HTTP_STANDARD_METHODS: ReadonlySet<string> = new Set<string>([
  'GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS',
]);
