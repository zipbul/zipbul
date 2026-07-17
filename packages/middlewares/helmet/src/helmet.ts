import { defineMiddleware } from '@zipbul/common';
import { isErr } from '@zipbul/result';
import { HttpAdapter, HttpContext } from '@zipbul/http-adapter';

import type { MiddlewareDefinition } from '@zipbul/common';

import type { HelmetOptions } from './options';
import { resolveHelmetOptions } from './options';
import { serializeReferrerPolicy } from './referrer-policy';
import { serializeXContentTypeOptions } from './x-content-type-options';

/**
 * Creates the `helmet` middleware.
 *
 * Options are validated once, at registration time, so a bad config fails fast
 * at boot rather than per request. The security headers are static (they do not
 * depend on the request), so they are stamped onto the response at the
 * `OnRequest` phase — where the response object already exists.
 *
 * ```ts
 * defineModule({
 *   name: 'App',
 *   adapters: [{
 *     adapter: HttpAdapter,
 *     middlewares: {
 *       [HttpAdapterPhase.OnRequest]: [helmetMiddleware()],
 *     },
 *   }],
 * });
 * ```
 */
export function helmetMiddleware(options?: Partial<HelmetOptions>): MiddlewareDefinition {
  const resolved = resolveHelmetOptions(options);
  if (isErr(resolved)) {
    throw resolved.data;
  }
  const config = resolved;

  return defineMiddleware([HttpAdapter], () => ctx => {
    const { response } = ctx.to(HttpContext);

    const xcto = serializeXContentTypeOptions(config.xContentTypeOptions);
    if (xcto !== undefined) {
      response.setHeader(xcto[0], xcto[1]);
    }

    const rp = serializeReferrerPolicy(config.referrerPolicy);
    if (rp !== undefined) {
      response.setHeader(rp[0], rp[1]);
    }
  });
}
