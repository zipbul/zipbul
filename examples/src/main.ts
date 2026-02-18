import { createApplication } from '@zipbul/core';

import { appModule } from './module';

const app = createApplication(appModule);

app.get('asbc');
await app.start();
await app.stop();
