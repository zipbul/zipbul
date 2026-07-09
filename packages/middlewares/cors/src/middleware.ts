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
 * Register on `HttpAdapterPhase.OnRequest` via a module's middleware map:
 *
 * ```ts
 * defineModule({
 *   name: 'App',
 *   adapters: [
 *     {
 *       adapter: HttpAdapter,
 *       middlewares: {
 *         [HttpAdapterPhase.OnRequest]: [corsMiddleware({ origin: 'https://example.com' })],
 *       },
 *     },
 *   ],
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

    if (result.action === CorsAction.Reject) {
      return;
    }

    const response = http.response;

    const writeHeader = (value: string, name: string): void => {
      if (name === HttpHeader.Vary) {
        response.appendHeader(name, value);
      } else {
        response.setHeader(name, value);
      }
    };

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
