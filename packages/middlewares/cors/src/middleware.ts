import type { MiddlewareDefinition } from '@zipbul/common';

import { defineMiddleware } from '@zipbul/common';
import { HttpAdapter, HttpContext, HttpHeader } from '@zipbul/http-adapter';

import type { CorsOptions } from './options';

import { Cors } from './cors';
import { CorsAction } from './enums';

/**
 * Wraps the framework-agnostic {@link Cors} engine as a zipbul HTTP middleware.
 *
 * Options are resolved and validated at registration time (`Cors.create`)
 * so configuration errors fail fast at boot.
 *
 * Register declaratively on `HttpAdapterPhase.OnRequest` via the module's
 * adapter config (there is no runtime `addMiddlewares` API):
 *
 * ```ts
 * defineModule({
 *   adapters: [{
 *     adapter: HttpAdapter,
 *     middlewares: {
 *       [HttpAdapterPhase.OnRequest]: [corsMiddleware({ origin: 'https://example.com' })],
 *     },
 *   }],
 * });
 * ```
 *
 * @throws {CorsError} when options fail validation.
 */
export function corsMiddleware(opts?: CorsOptions): MiddlewareDefinition {
  const cors = Cors.create(opts);

  return defineMiddleware([HttpAdapter], () => async ctx => {
    const http = ctx.to(HttpContext);
    const raw = http.rawRequest;
    if (raw === undefined) {
      return;
    }

    const result = await cors.handle(raw);

    const response = http.response;

    const writeHeader = (value: string, name: string): void => {
      if (name === HttpHeader.Vary) {
        response.appendHeader(name, value);
      } else {
        response.setHeader(name, value);
      }
    };

    if (result.action === CorsAction.Reject) {
      // Not a CORS success, but cache-correctness headers (chiefly Vary: Origin, and
      // any already-negotiated Access-Control-* on a failed preflight) must still ride
      // on the response (STANDARDS §7.1). The request itself is not blocked here.
      result.headers.forEach(writeHeader);
      return;
    }

    if (result.action === CorsAction.RespondPreflight) {
      response.setStatus(result.statusCode);
      result.headers.forEach(writeHeader);
      response.setHeader(HttpHeader.ContentLength, '0');
      response.send();
      return;
    }

    // CorsAction.Continue
    result.headers.forEach(writeHeader);
  });
}
