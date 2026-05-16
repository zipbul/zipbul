import { createApplication } from '@zipbul/core';
import { corsMiddleware } from '@zipbul/cors';
import { HttpAdapter, HttpAdapterPhase } from '@zipbul/http-adapter';
import { Logger } from '@zipbul/logger';

import { requestTimingMiddleware } from './middleware/request-timing.middleware';
import { appModule } from './module';
import { TickAdapter, TickPhase } from './tick/tick';
import { tickAuditMiddleware } from './tick/tick.middleware';
import { UsersService } from './users/users.service';

const logger = new Logger('App');

const app = createApplication(appModule);

const httpAdapter = app.attach(HttpAdapter, { port: 5000 });
httpAdapter.addMiddlewares(HttpAdapterPhase.OnRequest, [
  corsMiddleware({ origin: 'https://allowed.example' }),
  requestTimingMiddleware(),
]);

// Inline custom adapter — defined inside `src/tick/`, compiled by `zb build`
// alongside the external HttpAdapter. Real periodic transport: a setInterval
// drives tick rounds at the configured cadence; OnTick middleware fires
// before each handler invocation; `app.stop()` halts the timer and drains.
const tickAdapter = app.attach(TickAdapter, { intervalMs: 1500 });
tickAdapter.addMiddlewares(TickPhase.OnTick, [tickAuditMiddleware]);

await app.start();

const usersService = app.get(UsersService) as UsersService;

logger.info(`UsersService loaded: ${usersService.findAll().length} users`);

const shutdown = async () => {
  await app.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
