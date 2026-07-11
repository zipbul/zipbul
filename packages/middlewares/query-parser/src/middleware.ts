import type { MiddlewareDefinition } from '@zipbul/common';

import { defineMiddleware } from '@zipbul/common';
import { isErr } from '@zipbul/result';
import { HttpAdapter, HttpContext, HttpStatus, httpError } from '@zipbul/http-adapter';

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
        // Supplies the parsed query as the raw value the `getQuery(dto)`
        // accessor reads. A malformed query (strict mode) is a CLIENT error, so
        // it is RETURNED as an `Err` (400) — the framework short-circuits the
        // pipeline into that response — never thrown (which would surface as an
        // attacker-triggerable 500).
        getQuery: (ctx) => {
          const queryString = ctx.to(HttpContext).request.queryString;

          if (queryString === null) {
            return {};
          }

          const result = parser.parseResult(queryString);

          if (isErr(result)) {
            // The parser's message is already fully formed and self-describing
            // (e.g. "Malformed query string: …" or "Conflict: …"); pass it
            // through rather than prefixing a second, sometimes-wrong copy.
            return httpError(HttpStatus.BadRequest, result.data.message);
          }

          return result;
        },
      },
    },
  });
}
