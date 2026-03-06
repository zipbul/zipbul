import { createApplication } from '@zipbul/core';
import { HttpAdapter } from '@zipbul/http-adapter';

import { appModule } from './module';
import { UsersService } from './users/users.service';

const app = createApplication(appModule);

app.addAdapter(new HttpAdapter({ port: 5000 }), {
  name: 'http',
  protocol: 'http',
});

await app.start();

const usersService = app.get(UsersService);

console.log('[app.get] UsersService users:', usersService.findAll().length);

process.on('SIGINT', async () => {
  await app.stop();
  process.exit(0);
});
