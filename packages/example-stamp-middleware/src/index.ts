import { defineMiddleware } from '@zipbul/common';
import { HttpContext } from '@zipbul/http-adapter';
import { Logger } from '@zipbul/logger';

/**
 * Per-request marker installed by {@link stampMiddleware} onto the HTTP
 * context. Demonstrates the published-augment contract: this class is
 * exported by the middleware library and merged into `HttpRequest` via the
 * `dist/context-augments.d.ts` that `zb build middleware` emits, so consumers
 * who `import { stampMiddleware }` get `ctx.request.stamp` typed without
 * touching their own `tsconfig.json`.
 */
export class Stamp {
  constructor(public readonly label: string) {}
}

export const stampMiddleware = defineMiddleware(() => {
  const logger = new Logger('StampMiddleware');
  return (ctx) => {
    const http = ctx.to(HttpContext);
    http.request.stamp = new Stamp('tested');
    http.response.setHeader('X-Stamp', 'tested');
    logger.info('stamp set');
  };
});
