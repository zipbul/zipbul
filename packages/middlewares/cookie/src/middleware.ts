import type { MiddlewareDefinition } from '@zipbul/common';

import { defineMiddleware } from '@zipbul/common';
import { HttpAdapter, HttpContext, HttpHeader } from '@zipbul/http-adapter';

import type { CookieParserOptions } from './interfaces';

import { CookieParser } from './cookie-parser';
import { CookieJar } from './cookie-jar';
import { cookieJarKey } from './context-keys';

/**
 * The pair of middleware definitions produced by {@link cookieMiddleware}.
 *
 * Cookie handling spans two points in the request lifecycle, so — unlike the single-phase
 * `corsMiddleware` — the factory returns two definitions to register at two phases:
 *
 * - `onRequest` at {@link HttpAdapterPhase.OnRequest}: parses the inbound `Cookie` header into a
 *   {@link CookieJar} and publishes it on the context under {@link cookieJarKey}.
 * - `beforeResponse` at {@link HttpAdapterPhase.BeforeResponse}: serializes every cookie queued via
 *   `jar.set()` / `jar.delete()` and appends one `Set-Cookie` header per cookie.
 *
 * @public
 */
export interface CookieMiddleware {
  readonly onRequest: MiddlewareDefinition;
  readonly beforeResponse: MiddlewareDefinition;
}

/**
 * Wraps {@link CookieParser} + {@link CookieJar} as a pair of zipbul HTTP middlewares.
 *
 * One {@link CookieParser} is built and validated at registration (`CookieParser.create`), so
 * configuration errors fail fast at boot — mirroring `corsMiddleware`'s `Cors.create`.
 *
 * Register both phases:
 *
 * ```ts
 * const cookies = cookieMiddleware({ secrets: [process.env.COOKIE_SECRET!] });
 * httpAdapter.addMiddlewares(HttpAdapterPhase.OnRequest, [cookies.onRequest]);
 * httpAdapter.addMiddlewares(HttpAdapterPhase.BeforeResponse, [cookies.beforeResponse]);
 *
 * // In a handler / downstream middleware:
 * const jar = ctx.use(cookieJarKey);
 * const session = await jar.get('session');
 * jar.set('session', 'value', { httpOnly: true });
 * ```
 *
 * @throws {CookieError} when options fail validation (weak secret, invalid algorithm, etc.).
 */
export function cookieMiddleware(options?: CookieParserOptions): CookieMiddleware {
  const parser = CookieParser.create(options);

  const onRequest = defineMiddleware({
    adapters: [HttpAdapter],
    provides: [cookieJarKey],
    factory: () => (ctx) => {
      const http = ctx.to(HttpContext);
      const raw = http.rawRequest;
      if (raw === undefined) {
        return;
      }
      // The request `Cookie` header (HttpHeader only models the response `Set-Cookie`).
      ctx.set(cookieJarKey, new CookieJar(parser, raw.headers.get('cookie') ?? ''));
    },
  });

  const beforeResponse = defineMiddleware([HttpAdapter], () => async (ctx) => {
    const http = ctx.to(HttpContext);
    const jar = ctx.get(cookieJarKey);
    if (jar === undefined) {
      return;
    }

    const raw = http.rawRequest;
    // secure:'auto' resolves against the request channel. HttpContext exposes only the request URL,
    // so derive the scheme from it; absent a raw request, fall back to insecure (no Secure emitted).
    const isSecure = raw !== undefined && new URL(raw.url).protocol === 'https:';

    const headers = await jar.getSetCookieHeaders({ isSecure });
    for (const header of headers) {
      // One appendHeader per cookie — Set-Cookie must never be comma-folded (RFC 6265 §3).
      http.response.appendHeader(HttpHeader.SetCookie, header);
    }
  });

  return { onRequest, beforeResponse };
}
