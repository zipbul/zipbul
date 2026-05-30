import type { MiddlewareDefinition } from '@zipbul/common';

import { defineMiddleware } from '@zipbul/common';
import { HttpAdapter, HttpContext } from '@zipbul/http-adapter';

import type { QueryParserOptions } from './interfaces';

import { QueryParser } from './query-parser';

/**
 * Wraps the framework-agnostic {@link QueryParser} as a zipbul HTTP middleware.
 *
 * Options are resolved and validated at registration time (`QueryParser.create`)
 * so configuration errors fail fast at boot. At request time the raw query
 * string (`HttpRequest.queryString`) is parsed and assigned to
 * `HttpRequest.query` for downstream consumers.
 *
 * Register on `HttpAdapterPhase.BeforeValidate` so the parsed query is available
 * before validation runs:
 *
 * ```ts
 * httpAdapter.addMiddlewares(HttpAdapterPhase.BeforeValidate, [
 *   queryParserMiddleware({ nesting: true }),
 * ]);
 * ```
 *
 * In strict mode a malformed query string surfaces as a {@link QueryParserError}
 * that propagates to the pipeline's error handler.
 *
 * @throws {QueryParserError} when options fail validation (at registration).
 */
export function queryParserMiddleware(opts?: QueryParserOptions): MiddlewareDefinition {
  const parser = QueryParser.create(opts);

  return defineMiddleware([HttpAdapter], () => (ctx) => {
    const http = ctx.to(HttpContext);
    const queryString = http.request.queryString;

    http.request.query = queryString === null ? {} : parser.parse(queryString);
  });
}
