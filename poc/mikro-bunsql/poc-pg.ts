import { MikroORM } from '@mikro-orm/sql';
import { BunPgDriver } from './bun-pg-mikro-driver';
import { User } from './entity';

const orm = await MikroORM.init({
  driver: BunPgDriver as any,
  clientUrl: 'postgres://poc:poc@127.0.0.1:55432/pocdb',
  entities: [User],
});
console.log('[PG] ORM init OK, platform =', orm.em.getPlatform().constructor.name);
await orm.em.getConnection().execute('drop table if exists "user"');
await orm.em.getConnection().execute('create table "user" (id serial primary key, name varchar(255) not null, email varchar(255) not null unique)');
console.log('[PG] schema created');

const em = orm.em.fork();
const u = em.create(User, { name: 'erin', email: 'e@pg.io' });
em.persist(u);
await em.flush();
console.log('[PG] inserted id =', u.id);

const found = await orm.em.fork().findOneOrFail(User, { email: 'e@pg.io' });
console.log('[PG] queried back =', { id: found.id, name: found.name, email: found.email });

// prove it is REAL postgres
const ver: any = await orm.em.getConnection().execute('select version() as v');
console.log('[PG] server =', String(ver[0].v).slice(0, 40));
await orm.close(true);
console.log('[PG] PoC SUCCESS');
