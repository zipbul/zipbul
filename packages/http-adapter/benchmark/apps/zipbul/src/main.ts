import { createApplication } from '@zipbul/core';
import { HttpAdapter } from '@zipbul/http-adapter';

import { appModule } from './module';

const port = Number(process.env['BENCH_PORT'] ?? 3000);

const app = createApplication(appModule);

app.attach(HttpAdapter, { port });

await app.start();

console.log(`Zipbul listening on :${port}`);
