import { MiddlewareHook } from '@zipbul/common';
import { createApplication } from '@zipbul/core';
import { HttpAdapter } from '@zipbul/http-adapter';

import { requestTimingMiddleware } from './middleware/request-timing.middleware';
import { appModule } from './module';
import { UsersService } from './users/users.service';

const app = createApplication(appModule);

const httpAdapter = new HttpAdapter({ port: 5000 });
httpAdapter.addMiddlewares(MiddlewareHook.OnReceive, [requestTimingMiddleware()]);

app.addAdapter(httpAdapter);

await app.start();

const usersService = app.get(UsersService);

console.log('[app.get] UsersService users:', usersService.findAll().length);

process.on('SIGINT', async () => {
  await app.stop();
  process.exit(0);
});
