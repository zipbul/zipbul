import { defineModule } from '@zipbul/core';
import { corsMiddleware } from '@zipbul/cors';
import { HttpAdapter, HttpAdapterPhase } from '@zipbul/http-adapter';

import { requestTimingMiddleware } from './middleware/request-timing.middleware';
import { TickAdapter } from './tick/tick';
import { tickAuditMiddleware } from './tick/tick.middleware';

// Declarative middleware registration. Global (phase-wide) middleware is wired
// here, keyed by adapter and pipeline phase, so the AOT compiler serializes it
// into the generated adapterConfig and the bootstrap applies it via the
// adapter's applyConfig — no runtime `addMiddlewares` calls. Phase
// keys may be the adapter's phase-enum member (a TS enum like
// HttpAdapterPhase, resolved to its value by the compiler) or the phase string
// directly (TickPhase is an as-const object, so its value 'OnTick' is used).
export const appModule = defineModule({
  name: 'App',
  adapters: [
    {
      adapter: HttpAdapter,
      middlewares: {
        [HttpAdapterPhase.OnRequest]: [
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
