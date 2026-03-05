import { defineMiddleware, type MiddlewareDefinition } from '@zipbul/common';

import type { QueryParserOptions } from './interfaces';

import { HttpContext } from '../../adapter';
import { QueryParser } from './query-parser';

/**
 * Creates a query string parser middleware definition.
 *
 * @param options - Query parser configuration.
 * @returns A frozen {@link MiddlewareDefinition} that parses the request
 *   query string into `req.query`.
 *
 * @example
 * ```ts
 * adapter.addMiddlewares(MiddlewareHook.PostParseData, [
 *   queryParserMiddleware({ parseArrays: true, depth: 3 }),
 * ]);
 * ```
 *
 * @public
 */
export function queryParserMiddleware(options: QueryParserOptions = {}): MiddlewareDefinition {
  const parser = new QueryParser(options);

  return defineMiddleware((ctx) => {
    const http = ctx.to(HttpContext);
    const req = http.request;
    const questionIndex = req.url.indexOf('?');

    if (questionIndex === -1) {
      req.query = {};

      return;
    }

    const queryString = req.url.slice(questionIndex + 1);

    if (queryString.length === 0) {
      req.query = {};

      return;
    }

    req.query = parser.parse(queryString);
  });
}
