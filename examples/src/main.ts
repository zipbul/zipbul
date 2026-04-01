import { createApplication } from '@zipbul/core';
import { HttpAdapter, HttpPhase } from '@zipbul/http-adapter';
import { Logger } from '@zipbul/logger';

import { requestTimingMiddleware } from './middleware/request-timing.middleware';
import { appModule } from './module';
import { UsersService } from './users/users.service';

const logger = new Logger('App');

const app = createApplication(appModule);

const httpAdapter = app.attach(HttpAdapter, { port: 5000 });
httpAdapter.addMiddlewares(HttpPhase.OnRequest, [requestTimingMiddleware()]);

await app.start();

const usersService = app.get(UsersService);

logger.info(`UsersService loaded: ${usersService.findAll().length} users`);

const shutdown = async () => {
  await app.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
