import { defineMiddleware } from '@zipbul/common';
import type { MiddlewareDefinition } from '@zipbul/common';
import { HttpAdapter, HttpContext, type HttpResponse } from '@zipbul/http-adapter';
import { HttpHeader } from '@zipbul/shared';

import { Cors } from './cors';
import { CorsAction } from './enums';
import type { CorsOptions } from './interfaces';

type SetStatusArg = Parameters<HttpResponse['setStatus']>[0];

/**
 * Wraps the framework-agnostic {@link Cors} engine as a zipbul HTTP middleware.
 *
 * Options are resolved and validated at registration time (`Cors.create`)
 * so configuration errors fail fast at boot.
 *
 * Register on `HttpPhase.OnRequest`:
 *
 * ```ts
 * httpAdapter.addMiddlewares(HttpPhase.OnRequest, [
 *   corsMiddleware({ origin: 'https://example.com' }),
 * ]);
 * ```
 *
 * @throws {CorsError} when options fail validation.
 */
export function corsMiddleware(opts?: CorsOptions): MiddlewareDefinition {
  const cors = Cors.create(opts);

  return defineMiddleware([HttpAdapter], () => async (ctx) => {
    const http = ctx.to(HttpContext);
    const raw = http.rawRequest;
    if (raw === undefined) return;

    const result = await cors.handle(raw);

    if (result.action === CorsAction.Reject) return;

    const response = http.response;

    if (result.action === CorsAction.RespondPreflight) {
      response.setStatus(result.statusCode as SetStatusArg);
      result.headers.forEach((value, name) => {
        response.setHeader(name, value);
      });
      response.setHeader(HttpHeader.ContentLength, '0');
      response.send();
      return;
    }

    // CorsAction.Continue
    result.headers.forEach((value, name) => {
      if (name.toLowerCase() === HttpHeader.Vary) {
        response.appendHeader(name, value);
      } else {
        response.setHeader(name, value);
      }
    });
  });
}
