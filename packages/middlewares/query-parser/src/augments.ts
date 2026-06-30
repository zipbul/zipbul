import type { Class } from '@zipbul/common';

/**
 * Context augment contributed by the query-parser middleware: a typed
 * `getQuery<T>(dto)` accessor on the framework's `HttpRequest`. Previously
 * emitted as `context-augments.d.ts` by `zb build middleware`; now declared in
 * source so the tsgo build type-checks the middleware and ships the augment
 * `.d.ts` to consumers like any other library type.
 */
declare module '@zipbul/http-adapter' {
  interface HttpRequest {
    getQuery<T>(dto: Class<T>): T;
  }
}
