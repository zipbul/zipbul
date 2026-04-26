/**
 * HTTP methods natively supported by the framework — those with dedicated
 * decorators (`@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Options`, `@Head`).
 * Used as the base set for `allowedMethods`; non-standard methods may be
 * appended via `HttpServerOptions.customMethods` at boot time.
 *
 * TRACE / CONNECT are permanently unsupported — see {@link ForbiddenHttpMethod}.
 * Requests with these methods receive 501 Not Implemented (RFC 9110 §15.6.2).
 */
export const HTTP_STANDARD_METHODS: ReadonlySet<string> = new Set<string>([
  'GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS',
]);

/**
 * HTTP methods that are *permanently* rejected by the framework, both at
 * compile time (decorator + options type narrowing) and at runtime (boot
 * validation throws).
 *
 * - `TRACE`: XST attack vector (OWASP). RFC 9110 §9.3.8 echo rules require
 *   strict server-side enforcement (sensitive header stripping) that cannot
 *   be statically guaranteed for user-written handlers.
 * - `CONNECT`: RFC 9110 §9.3.6 — designed for forward proxies. Origin server
 *   frameworks (zipbul) cannot meaningfully implement CONNECT semantics.
 *
 * Industry consensus: nginx, Apache (TraceEnable off default), Express,
 * NestJS, Fastify, Vercel, Cloudflare Workers — none expose these methods.
 *
 * @public
 */
export type ForbiddenHttpMethod = 'TRACE' | 'CONNECT';

/** Runtime mirror of {@link ForbiddenHttpMethod} for boot-time guards. */
export const FORBIDDEN_HTTP_METHODS: ReadonlySet<string> = new Set<string>([
  'TRACE', 'CONNECT',
]);
