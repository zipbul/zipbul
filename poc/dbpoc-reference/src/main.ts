import { createApplication } from '@zipbul/core';
import { HttpAdapter } from '@zipbul/http-adapter';
import { appModule } from './module';

const app = createApplication(appModule);
app.attach(HttpAdapter, { port: 5055 });
await app.start();
