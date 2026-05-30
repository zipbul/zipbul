import { contextKey } from '@zipbul/common';

import type { CookieJar } from './cookie-jar';

/**
 * Per-request {@link CookieJar} published by {@link cookieMiddleware}'s OnRequest handler.
 *
 * Downstream handlers and middleware read the jar with `ctx.use(cookieJarKey)` (throws if the
 * middleware is not registered) or `ctx.get(cookieJarKey)` (optional). The BeforeResponse handler
 * reads it back to flush queued `Set-Cookie` headers. A single module-level key is intentional:
 * it lets the AOT compiler verify, via the middleware's `provides`, that any `ctx.use(cookieJarKey)`
 * has an upstream provider.
 *
 * @public
 */
export const cookieJarKey = contextKey<CookieJar>('@zipbul/cookie.jar');
