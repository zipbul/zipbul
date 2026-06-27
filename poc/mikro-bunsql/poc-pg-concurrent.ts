import { MikroORM } from '@mikro-orm/sql';
import { BunPgDriver } from './bun-pg-mikro-driver';
import { User } from './entity';

const orm = await MikroORM.init({
  driver: BunPgDriver as any,
  clientUrl: 'postgres://poc:poc@127.0.0.1:55432/pocdb',
  entities: [User],
});
await orm.em.getConnection().execute('drop table if exists "user"');
await orm.em.getConnection().execute('create table "user" (id serial primary key, name varchar(255) not null, email varchar(255) not null unique)');
console.log('[PG-CONC] schema ready, pool max=10');

// 20 concurrent transactional inserts (each in its own em.transactional => own reserved connection)
const N = 20;
const results = await Promise.allSettled(
  Array.from({ length: N }, (_, i) =>
    orm.em.transactional(async (em) => {
      const u = em.create(User, { name: `user${i}`, email: `u${i}@pg.io` });
      em.persist(u);
    })
  )
);
const ok = results.filter(r => r.status === 'fulfilled').length;
const failed = results.filter(r => r.status === 'rejected');
console.log(`[PG-CONC] ${ok}/${N} transactions committed`);
if (failed.length) console.log('[PG-CONC] sample failure:', String(failed[0].reason).slice(0,160));

const count: any = await orm.em.getConnection().execute('select count(*)::int as c from "user"');
console.log('[PG-CONC] rows in db =', count[0].c);

// rollback test: failing transaction must not persist
try {
  await orm.em.transactional(async (em) => {
    em.persist(em.create(User, { name: 'ghost', email: 'ghost@pg.io' }));
    await em.flush();
    throw new Error('boom');
  });
} catch { /* expected */ }
const ghost: any = await orm.em.getConnection().execute(`select count(*)::int as c from "user" where email='ghost@pg.io'`);
console.log('[PG-CONC] ghost rows after rollback =', ghost[0].c, '(expect 0)');

await orm.close(true);
console.log('[PG-CONC] DONE');
