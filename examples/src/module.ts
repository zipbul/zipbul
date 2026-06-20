import { defineModule } from '@zipbul/core';
import { corsMiddleware } from '@zipbul/cors';
import { HttpAdapter } from '@zipbul/http-adapter';

import { requestTimingMiddleware } from './middleware/request-timing.middleware';
import { TickAdapter } from './tick/tick';
import { tickAuditMiddleware } from './tick/tick.middleware';

// Declarative middleware registration. Global (phase-wide) middleware is wired
// here, keyed by adapter and pipeline phase, so the AOT compiler serializes it
// into the generated adapterConfig and the bootstrap applies it via the
// adapter's applyMiddlewareConfig — no runtime `addMiddlewares` calls. Phase
// keys are the adapter's phase names ('OnRequest', 'OnTick').
export const appModule = defineModule({
  name: 'App',
  adapters: [
    {
      adapter: HttpAdapter,
      middlewares: {
        OnRequest: [
          corsMiddleware({ origin: 'https://allowed.example' }),
          requestTimingMiddleware(),
        ],
      },
    },
    {
      adapter: TickAdapter,
      middlewares: {
        OnTick: [tickAuditMiddleware],
      },
    },
  ],
});
