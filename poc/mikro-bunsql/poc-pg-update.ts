import { MikroORM, SqlSchemaGenerator, EntitySchema } from '@mikro-orm/sql';
import { BunPgDriver } from './bun-pg-mikro-driver';

// v1 entity
const WidgetV1 = new EntitySchema({ name: 'Widget', properties: {
  id: { type: 'number', primary: true, autoincrement: true },
  name: { type: 'string' },
}});

const orm = await MikroORM.init({ driver: BunPgDriver as any, clientUrl: 'postgres://poc:poc@127.0.0.1:55432/pocdb', entities: [WidgetV1], extensions: [SqlSchemaGenerator] });
await orm.schema.drop({ dropForeignKeys: true });
await orm.schema.create();
console.log('[UPDATE] v1 schema created');

await orm.close(true);

// v2 entity: add a column -> requires introspection-based diff
const WidgetV2 = new EntitySchema({ name: 'Widget', properties: {
  id: { type: 'number', primary: true, autoincrement: true },
  name: { type: 'string' },
  price: { type: 'number', nullable: true },   // NEW column
}});
const orm2 = await MikroORM.init({ driver: BunPgDriver as any, clientUrl: 'postgres://poc:poc@127.0.0.1:55432/pocdb', entities: [WidgetV2], extensions: [SqlSchemaGenerator] });

const diff = await orm2.schema.getUpdateSchemaSQL();
console.log('[UPDATE] introspection diff SQL:', diff.replace(/\s+/g,' ').trim() || '(empty)');
await orm2.schema.update();   // apply diff via Introspector
const cols: any = await orm2.em.getConnection().execute(`select column_name from information_schema.columns where table_name='widget' order by ordinal_position`);
console.log('[UPDATE] columns after updateSchema:', cols.map((c:any)=>c.column_name).join(','));
console.log('[UPDATE]', cols.some((c:any)=>c.column_name==='price') ? 'SCHEMA-DIFF + UPDATE OK (introspector works)' : 'FAILED: price not added');
await orm2.close(true);
