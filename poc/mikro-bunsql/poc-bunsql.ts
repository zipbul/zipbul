import { MikroORM, SqliteDriver } from '@mikro-orm/sql';
import { BunSqlDialect } from './bun-sql-dialect';
import { User } from './entity';

const orm = await MikroORM.init({
  driver: SqliteDriver,
  dbName: ':memory:',
  driverOptions: new BunSqlDialect('sqlite://:memory:'),
  entities: [User],
});
console.log('[Bun.SQL] ORM init OK');
await orm.em.getConnection().execute('create table "user" (id integer primary key autoincrement, name text not null, email text not null unique)');
console.log('[Bun.SQL] schema created');

const em = orm.em.fork();
const u = em.create(User, { name: 'dave', email: 'd@x.io' });
em.persist(u);
await em.flush();
console.log('[Bun.SQL] inserted id =', u.id);

const found = await orm.em.fork().findOneOrFail(User, { email: 'd@x.io' });
console.log('[Bun.SQL] queried back =', { id: found.id, name: found.name, email: found.email });
await orm.close(true);
console.log('[Bun.SQL] PoC SUCCESS');
