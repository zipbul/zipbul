import { type Dialect, type Driver, type DatabaseConnection, type QueryResult, type DatabaseIntrospector, type QueryCompiler, type DialectAdapter, type Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, CompiledQuery } from 'kysely';
import { AbstractSqlDriver, AbstractSqlConnection } from '@mikro-orm/sql';
import { PostgreSqlPlatform } from '@mikro-orm/postgresql';
import { MikroORM, RequestContext, type Options, type EntityManager, type EntityRepository, type EntityName } from '@mikro-orm/core';
export { Entity, PrimaryKey, Property, ManyToOne, OneToMany, OneToOne, ManyToMany, Enum, Unique, Index } from '@mikro-orm/decorators/es';

function normErr(e:any){ if(e&&typeof e.errno!=='undefined'&&(typeof e.code!=='string'||e.code.startsWith('ERR_'))){try{e.code=String(e.errno)}catch{}} return e; }
class BunReserved implements DatabaseConnection {
  constructor(private readonly r:any){}
  async executeQuery<R>(cq:CompiledQuery):Promise<QueryResult<R>>{ try{ const res:any=await this.r.unsafe(cq.sql,[...cq.parameters]); const rows=Array.isArray(res)?res as R[]:[]; const out:QueryResult<R>={rows}; if(res?.affectedRows!=null)(out as any).numAffectedRows=BigInt(res.affectedRows); if(res?.lastInsertRowid!=null)(out as any).insertId=BigInt(res.lastInsertRowid); return out; }catch(e){throw normErr(e)} }
  async *streamQuery<R>():AsyncIterableIterator<QueryResult<R>>{ throw new Error('streaming unsupported'); }
  async release(){ await this.r.release(); }
}
class BunPgKyselyDriver implements Driver {
  private sql:any; constructor(private url:string, private max:number){}
  async init(){ this.sql=new Bun.SQL(this.url,{max:this.max}); }
  async acquireConnection(){ return new BunReserved(await this.sql.reserve()); }
  async beginTransaction(c:DatabaseConnection,s?:any){ if(s?.isolationLevel)await c.executeQuery(CompiledQuery.raw(`set transaction isolation level ${s.isolationLevel}`)); await c.executeQuery(CompiledQuery.raw('begin')); }
  async commitTransaction(c:DatabaseConnection){ await c.executeQuery(CompiledQuery.raw('commit')); }
  async rollbackTransaction(c:DatabaseConnection){ await c.executeQuery(CompiledQuery.raw('rollback')); }
  async savepoint(c:DatabaseConnection,n:string){ await c.executeQuery(CompiledQuery.raw(`savepoint "${n}"`)); }
  async rollbackToSavepoint(c:DatabaseConnection,n:string){ await c.executeQuery(CompiledQuery.raw(`rollback to savepoint "${n}"`)); }
  async releaseSavepoint(c:DatabaseConnection,n:string){ await c.executeQuery(CompiledQuery.raw(`release savepoint "${n}"`)); }
  async releaseConnection(c:DatabaseConnection){ await (c as BunReserved).release(); }
  async destroy(){ await this.sql?.close?.(); }
}
class BunPgDialect implements Dialect {
  constructor(private url:string, private max=10){}
  createDriver():Driver{ return new BunPgKyselyDriver(this.url,this.max); }
  createQueryCompiler():QueryCompiler{ return new PostgresQueryCompiler(); }
  createAdapter():DialectAdapter{ return new PostgresAdapter(); }
  createIntrospector(db:Kysely<any>):DatabaseIntrospector{ return new PostgresIntrospector(db); }
}
class BunPgConnection extends AbstractSqlConnection { createKyselyDialect():Dialect{ return new BunPgDialect(this.config.get('clientUrl') as string); } }
export class BunPostgreSqlDriver extends AbstractSqlDriver<BunPgConnection,PostgreSqlPlatform>{ constructor(config:any){ super(config,new PostgreSqlPlatform(),BunPgConnection,['kysely']); } }

const _reg = new Map<string, MikroORM>();   // internal only (not user-facing)
function emFor(conn:string):EntityManager{ const c=RequestContext.getEntityManager(conn) as EntityManager|undefined; if(c)return c; const o=_reg.get(conn); if(!o)throw new Error(`connection '${conn}' not initialized`); return o.em; }

export function MikroOrm(options: Options<any> & { connection?: string }) {
  const conn = options.connection ?? 'default';
  abstract class MikroOrmService {
    orm!: MikroORM;
    async onInit(){ this.orm = await MikroORM.init(options as any); _reg.set(conn, this.orm); }
    async onDestroy(){ _reg.delete(conn); await this.orm?.close(true); }
    get em(): EntityManager { return emFor(conn); }
    enter(){ RequestContext.enter(this.orm.em); }
  }
  return MikroOrmService;
}

/** Base for a user @Injectable repository class: `class UserRepository extends Repository(User) {}` -> inject(UserRepository). */
export function Repository<T extends object>(entity: EntityName<T>, connection = 'default') {
  class Base {
    constructor() {
      return new Proxy(this, {
        get(target, prop, recv) {
          if (prop in target) return Reflect.get(target, prop, recv);   // user-defined methods win
          const repo = emFor(connection).getRepository<T>(entity);       // per-call -> request fork
          const v = (repo as any)[prop];
          return typeof v === 'function' ? v.bind(repo) : v;
        },
      });
    }
  }
  return Base as unknown as new () => EntityRepository<T>;
}
