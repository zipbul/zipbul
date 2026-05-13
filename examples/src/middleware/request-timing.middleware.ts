import type { MiddlewareDefinition } from '@zipbul/common';
import { defineMiddleware } from '@zipbul/common';
import { HttpAdapter, HttpContext } from '@zipbul/http-adapter';
import { Logger } from '@zipbul/logger';

import type { RequestTimingOptions } from './interfaces';

const DEFAULT_HEADER = 'X-Response-Time';

/**
 * Measures request processing time and sets a response header.
 *
 * @param options - Configuration for the timing middleware
 * @returns A frozen `MiddlewareDefinition` bound to `HttpAdapter`
 *
 * @example
 * ```ts
 * httpAdapter.addMiddlewares(HttpAdapterPhase.OnReceive, [
 *   requestTimingMiddleware({ headerName: 'X-Timing' }),
 * ]);
 * ```
 *
 * @public
 */
export function requestTimingMiddleware(options: RequestTimingOptions = {}): MiddlewareDefinition {
  const headerName = options.headerName ?? DEFAULT_HEADER;
  const logger = new Logger('RequestTimingMiddleware');

  return defineMiddleware([HttpAdapter], () => {
    return (ctx) => {
      const http = ctx.to(HttpContext);
      const start = performance.now();
      const req = http.request;
      const res = http.response;

      logger.info(`-> ${req.method} ${req.url}`);

      const elapsed = (performance.now() - start).toFixed(2);
      res.setHeader(headerName, `${elapsed}ms`);

      logger.info(`<- ${req.method} ${req.url} ${elapsed}ms`);
    };
  });
}
