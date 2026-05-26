import { createApplication } from '@zipbul/core';
import { HttpAdapter } from '@zipbul/http-adapter';
import { SqlSchemaGenerator } from '@mikro-orm/sql';
import { appModule } from './module';
import { Database } from './database/orm.service';

const app = createApplication(appModule);
app.attach(HttpAdapter, { port: 5088 });
await app.start();

// dev-only schema + seed, done explicitly OUTSIDE onInit
const db = app.get(Database) as Database;
const gen = (db.orm.config as any) && db.orm.getSchemaGenerator?.() ? db.orm.getSchemaGenerator() : null;
await (db.orm as any).schema?.drop?.({ dropForeignKeys: true }).catch(() => {});
await (db.orm as any).schema?.create?.();
const seed = db.orm.em.fork();
const { User } = await import('./entities/user.entity');
seed.persist(seed.create(User, { name: 'Ada', email: 'ada@x.io' }));
seed.persist(seed.create(User, { name: 'Alan', email: 'alan@x.io' }));
await seed.flush();
