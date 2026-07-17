import { defineMiddleware } from '@zipbul/common';
import { isErr } from '@zipbul/result';
import { HttpAdapter, HttpContext } from '@zipbul/http-adapter';

import type { MiddlewareDefinition } from '@zipbul/common';

import type { CsrfOptions } from './options';
import { resolveCsrfOptions } from './options';

/**
 * Creates the `csrf` middleware.
 *
 * Options are validated once, at registration time, so a bad config fails fast
 * at boot rather than per request. Register it declaratively on the HTTP
 * adapter's `OnRequest` phase in your module:
 *
 * ```ts
 * defineModule({
 *   name: 'App',
 *   adapters: [{
 *     adapter: HttpAdapter,
 *     middlewares: {
 *       [HttpAdapterPhase.OnRequest]: [csrfMiddleware()],
 *     },
 *   }],
 * });
 * ```
 */
export function csrfMiddleware(options?: CsrfOptions): MiddlewareDefinition {
  const resolved = resolveCsrfOptions(options);
  if (isErr(resolved)) {
    // `isErr` narrows to the error branch; `.data` is the Error from `err(...)`.
    throw resolved.data;
  }

  // Past the guard, `resolved` narrows to the success value.
  const config = resolved;

  return defineMiddleware([HttpAdapter], () => ctx => {
    if (!config.enabled) {
      return;
    }

    // Your middleware logic goes here. This demo sets a response header.
    const http = ctx.to(HttpContext);
    http.response.setHeader('X-Csrf', 'hello from zipbul');
  });
}
