import { MikroORM, SqliteDriver } from '@mikro-orm/sql';
import { BunSqliteDialect } from './bun-sqlite-dialect';
import { User } from './entity';

const orm = await MikroORM.init({
  driver: SqliteDriver,
  dbName: ':memory:',
  driverOptions: new BunSqliteDialect(':memory:'),
  entities: [User],
  // ES decorators -> metadata provided explicitly, no reflect-metadata
});

console.log('ORM init OK. driver =', orm.config.get('driver').name);
await orm.em.getConnection().execute('create table "user" (id integer primary key autoincrement, name text not null, email text not null unique)');
console.log('schema created');

const em = orm.em.fork();
const u = em.create(User, { name: 'alice', email: 'a@x.io' });
em.persist(u);
  await em.flush();
console.log('inserted id =', u.id);

const found = await orm.em.fork().findOneOrFail(User, { email: 'a@x.io' });
console.log('queried back =', { id: found.id, name: found.name, email: found.email });

await orm.close(true);
console.log('PoC SUCCESS');
