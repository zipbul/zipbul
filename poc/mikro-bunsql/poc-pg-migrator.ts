import { MikroORM, SqlSchemaGenerator, EntitySchema } from '@mikro-orm/sql';
import { Migrator } from '@mikro-orm/migrations';
import { BunPgDriver } from './bun-pg-mikro-driver';

const Thing = new EntitySchema({ name: 'Thing', properties: {
  id: { type: 'number', primary: true, autoincrement: true },
  label: { type: 'string' },
}});

const orm = await MikroORM.init({
  driver: BunPgDriver as any,
  clientUrl: 'postgres://poc:poc@127.0.0.1:55432/pocdb',
  entities: [Thing],
  extensions: [SqlSchemaGenerator, Migrator],
  migrations: { path: './migrations', emit: 'ts', snapshot: false },
});
// clean slate
await orm.schema.drop({ dropForeignKeys: true, dropMigrationsTable: true });
console.log('[MIG] migrator present:', typeof orm.migrator);

// 1) generate a migration from schema diff
const migration = await orm.migrator.create();
console.log('[MIG] createMigration ->', migration.fileName || '(no diff)');

// 2) check pending, then apply (up)
const pending = await orm.migrator.getPending();
console.log('[MIG] pending:', pending.map(p => p.name));
await orm.migrator.up();
console.log('[MIG] up() applied');

// 3) verify table + migrations bookkeeping table exist
const t: any = await orm.em.getConnection().execute(`select to_regclass('public.thing') as thing, to_regclass('public.mikro_orm_migrations') as mig`);
console.log('[MIG] thing table:', t[0].thing, '| migrations table:', t[0].mig);

// 4) executed migrations recorded?
const executed = await orm.migrator.getExecuted();
console.log('[MIG] executed migrations count:', executed.length);
console.log('[MIG]', (t[0].thing && t[0].mig && executed.length >= 1) ? 'MIGRATOR OK (generate+up+bookkeeping)' : 'FAILED');
await orm.close(true);
