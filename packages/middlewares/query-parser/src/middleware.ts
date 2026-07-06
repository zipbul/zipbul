import type { MiddlewareDefinition } from '@zipbul/common';

import { defineMiddleware } from '@zipbul/common';
import { HttpAdapter, HttpContext } from '@zipbul/http-adapter';

import type { QueryParserOptions } from './interfaces';

import { QueryParser } from './query-parser';

/**
 * Query-parser HTTP middleware factory (canonical form-2 shape:
 * `export function xMiddleware(opts?) { return defineMiddleware({...}) }`).
 *
 * Each call creates an independent instance — different registration points
 * may use different options. Options are baker-validated at boot
 * (`QueryParser.create` throws {@link QueryParserError} on invalid options).
 *
 * The `augments` slot declares the typed `request.getQuery(dto)` accessor:
 * this middleware only SUPPLIES the parsed query (raw); the framework wires
 * baker DTO validation from the handler's `getQuery(SomeDto)` call site and
 * the installed accessor returns the validated instance — exactly like
 * `getBody`/`getParams`. `zb build middleware` extracts the declaration into
 * `dist/context-augments.d.ts` (consumer types) and
 * `dist/context-augments.json` (app AOT manifest).
 *
 * Register on `HttpAdapterPhase.BeforeValidate` (any phase before Validation):
 *
 * ```ts
 * middlewares: {
 *   [HttpAdapterPhase.BeforeValidate]: [queryParser({ nesting: true })],
 * }
 *
 * // In a handler:
 * @Get()
 * search(ctx: HttpContext) {
 *   const query = ctx.request.getQuery(SearchQueryDto); // typed + validated
 * }
 * ```
 *
 * @throws {QueryParserError} when options fail validation.
 */
export function queryParser(options?: QueryParserOptions): MiddlewareDefinition {
  const parser = QueryParser.create(options);

  return defineMiddleware({
    adapters: [HttpAdapter],
    augments: {
      request: {
        getQuery: (ctx) => {
          const queryString = ctx.to(HttpContext).request.queryString;

          return queryString === null ? {} : parser.parse(queryString);
        },
      },
    },
  });
}
