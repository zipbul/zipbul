import type { Class, MiddlewareDefinition } from '@zipbul/common';

import { defineMiddleware } from '@zipbul/common';
import { HttpAdapter, HttpContext } from '@zipbul/http-adapter';

import { QueryParser } from './query-parser';

/**
 * Query-parser HTTP middleware (canonical `export const … = defineMiddleware(…)`
 * shape so `zb build middleware` can extract the context augment and emit the
 * matching `context-augments.d.ts`).
 *
 * Parses the request query string once per request and augments the request
 * with a typed `getQuery<T>(dto)` accessor — consistent with the framework's
 * `getBody<T>(dto)` / `getParams<T>(dto)` accessors. Consumers read it as:
 *
 * ```ts
 * @Get()
 * search(ctx: HttpContext) {
 *   const query = ctx.request.getQuery(SearchQueryDto); // typed
 * }
 * ```
 *
 * Register on `HttpAdapterPhase.BeforeValidate`.
 */
export const queryParser: MiddlewareDefinition = defineMiddleware([HttpAdapter], () => {
  const parser = QueryParser.create();

  return (ctx) => {
    const http = ctx.to(HttpContext);
    const queryString = http.request.queryString;
    const parsed = queryString === null ? {} : parser.parse(queryString);

    http.request.getQuery = <T>(_dto: Class<T>): T => parsed as T;
  };
});
