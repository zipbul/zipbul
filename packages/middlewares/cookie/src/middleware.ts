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
      // The request `Cookie` header (HttpHeader models only the response `Set-Cookie`).
      ctx.set(cookieJarKey, new CookieJar(parser, raw.headers.get('cookie') ?? ''));
    },
  });

  const beforeResponse = defineMiddleware([HttpAdapter], () => async (ctx) => {
    const http = ctx.to(HttpContext);
    const jar = ctx.get(cookieJarKey);
    if (jar === undefined) {
      return;
    }

    // secure:'auto' resolves against the request channel. HttpContext exposes only the request URL,
    // so derive the scheme from it; absent or unparseable, fall back to insecure (no Secure emitted)
    // rather than letting a malformed URL throw out of the response-writing path.
    let isSecure = false;
    const raw = http.rawRequest;
    if (raw !== undefined) {
      try {
        isSecure = new URL(raw.url).protocol === 'https:';
      } catch {
        /* relative / malformed url → treat as insecure */
      }
    }

    // A malformed cookie surfaces its CookieError only at serialize time (cross-field Secure /
    // SameSite / prefix / size rules, key exhaustion). Contain it here: a single bad cookie must not
    // throw out of the response pipeline and break the whole response. The error is intentionally
    // swallowed at this boundary — standalone callers that want the loud signal use
    // jar.getSetCookieHeaders() directly, which still throws.
    let headers: string[];
    try {
      headers = await jar.getSetCookieHeaders({ isSecure });
    } catch {
      return;
    }

    for (const header of headers) {
      // One appendHeader per cookie — Set-Cookie must never be comma-folded (RFC 6265 §3).
      http.response.appendHeader(HttpHeader.SetCookie, header);
    }
  });

  return { onRequest, beforeResponse };
}
