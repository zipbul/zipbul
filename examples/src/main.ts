import { createApplication } from '@zipbul/core';
import { HttpAdapter } from '@zipbul/http-adapter';
import { Logger } from '@zipbul/logger';

import { appModule } from './module';
import { TickAdapter } from './tick/tick';
import { UsersService } from './users/users.service';

const logger = new Logger('App');

const app = createApplication(appModule);

// Middleware for both adapters is declared on `appModule` (see ./module) and
// applied by the bootstrap; attaching only binds the transport options.
app.attach(HttpAdapter, { port: 5000 });

// Inline custom adapter — defined inside `src/tick/`, compiled by `zb build`
// alongside the external HttpAdapter. Real periodic transport: a setInterval
// drives tick rounds at the configured cadence; OnTick middleware fires
// before each handler invocation; `app.stop()` halts the timer and drains.
app.attach(TickAdapter, { intervalMs: 1500 });

await app.start();

const usersService = app.get(UsersService) as UsersService;

logger.info(`UsersService loaded: ${usersService.findAll().length} users`);

const shutdown = async () => {
  await app.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
