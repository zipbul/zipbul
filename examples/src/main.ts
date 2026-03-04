import { createApplication } from '@zipbul/core';

import { appModule } from './module';
import { UsersService } from './users/users.service';

const app = createApplication(appModule);

await app.start();

const usersService = app.get(UsersService);

console.log('[app.get] UsersService users:', usersService.findAll().length);

process.on('SIGINT', async () => {
  await app.stop();
  process.exit(0);
});
