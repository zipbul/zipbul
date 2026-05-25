import { MikroORM, SqlSchemaGenerator, EntitySchema } from '@mikro-orm/sql';
import { BunMysqlDriver } from './bun-mysql-mikro-driver';

const Item = new EntitySchema({ name: 'Item', properties: {
  id: { type: 'number', primary: true, autoincrement: true },
  title: { type: 'string' },
  qty: { type: 'number' },
}});

const orm = await MikroORM.init({
  driver: BunMysqlDriver as any,
  clientUrl: 'mysql://poc:poc@127.0.0.1:33306/pocdb',
  entities: [Item],
  extensions: [SqlSchemaGenerator],
});
console.log('[MYSQL] init OK, platform =', orm.em.getPlatform().constructor.name);
await orm.schema.drop({ dropForeignKeys: true });
await orm.schema.create();
console.log('[MYSQL] schema created');

const em = orm.em.fork();
const it = em.create(Item, { title: 'widget', qty: 42 });
em.persist(it);
await em.flush();
console.log('[MYSQL] inserted id =', it.id);

await orm.em.transactional(async (tem) => {
  tem.persist(tem.create(Item, { title: 'gadget', qty: 7 }));
});
const all = await orm.em.fork().findAll(Item, {});
console.log('[MYSQL] rows =', all.map(r => `${r.id}:${r.title}/${r.qty}`).join(', '));
const ver: any = await orm.em.getConnection().execute('select version() as v');
console.log('[MYSQL] server =', ver[0].v);
console.log('[MYSQL]', all.length === 2 ? 'MYSQL ROUND-TRIP + TXN OK' : 'FAILED');
await orm.close(true);
