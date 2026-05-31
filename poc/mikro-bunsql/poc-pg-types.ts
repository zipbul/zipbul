import { MikroORM } from '@mikro-orm/sql';
import { SqlSchemaGenerator } from '@mikro-orm/sql';
import { BunPgDriver } from './bun-pg-mikro-driver';
import { Event } from './entity-types';

const orm = await MikroORM.init({
  driver: BunPgDriver as any,
  clientUrl: 'postgres://poc:poc@127.0.0.1:55432/pocdb',
  entities: [Event],
  extensions: [SqlSchemaGenerator],
});
console.log('[TYPES] ORM init OK');

// === GATE 1: SchemaGenerator (migration/schema-gen over Bun.SQL dialect) ===
await orm.schema.drop({ dropForeignKeys: true });
  await orm.schema.create();   // create all tables from entity metadata
console.log('[TYPES] schema.refreshDatabase() OK  <-- SchemaGenerator works over Bun.SQL');
const ddl = await orm.schema.getCreateSchemaSQL();
console.log('[TYPES] generated DDL (excerpt):', ddl.replace(/\s+/g,' ').slice(0, 140), '...');

// === GATE 2: type coercion round-trip ===
const when = new Date('2026-05-25T10:20:30.000Z');
const em = orm.em.fork();
const e = em.create(Event, {
  name: 'launch',
  occurredAt: when,
  meta: { tags: ['a', 'b'], level: 7 },
  counter: '9007199254740993',     // > Number.MAX_SAFE_INTEGER, must survive as bigint
  active: true,
  amount: '123.45',
});
em.persist(e);
await em.flush();
console.log('[TYPES] inserted id =', e.id);

const got = await orm.em.fork().findOneOrFail(Event, { id: e.id });
const checks = {
  date_isDate: got.occurredAt instanceof Date,
  date_equal: got.occurredAt instanceof Date && got.occurredAt.toISOString() === when.toISOString(),
  json_isObject: typeof got.meta === 'object' && Array.isArray(got.meta.tags),
  json_equal: JSON.stringify(got.meta) === JSON.stringify({ tags: ['a','b'], level: 7 }),
  bigint_value: String(got.counter),
  bigint_preserved: String(got.counter) === '9007199254740993',
  boolean_isBool: typeof got.active === 'boolean' && got.active === true,
  decimal_value: got.amount,
};
console.log('[TYPES] round-trip:', JSON.stringify(checks, null, 2));
const allOk = checks.date_isDate && checks.date_equal && checks.json_isObject && checks.json_equal
  && checks.bigint_preserved && checks.boolean_isBool && checks.decimal_value === '123.45';
console.log('[TYPES]', allOk ? 'ALL TYPE CHECKS PASS' : 'SOME TYPE CHECKS FAILED');

await orm.close(true);
