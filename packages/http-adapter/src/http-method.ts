/**
 * HTTP methods natively supported by the framework — those with dedicated
 * decorators (`@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Options`, `@Head`).
 * Used as the base set for `allowedMethods`; non-standard methods may be
 * appended via `HttpServerOptions.customMethods` at boot time.
 *
 * TRACE / CONNECT are intentionally excluded — TRACE carries XST risk
 * (OWASP) and CONNECT targets forward proxies, not application servers.
 * Requests with these methods receive 501 Not Implemented (RFC 9110
 * §15.6.2). Operators who require them must opt in via `customMethods`.
 */
export const HTTP_STANDARD_METHODS: ReadonlySet<string> = new Set<string>([
  'GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS',
]);
