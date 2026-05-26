import { type Dialect, type Driver, type DatabaseConnection, type QueryResult, type DatabaseIntrospector, type QueryCompiler, type DialectAdapter, type Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, CompiledQuery } from 'kysely';
import { AbstractSqlDriver, AbstractSqlConnection } from '@mikro-orm/sql';
import { PostgreSqlPlatform } from '@mikro-orm/postgresql';
import { MikroORM, RequestContext, type Options, type EntityManager, type EntityRepository, type EntityName } from '@mikro-orm/core';
export { Entity, PrimaryKey, Property, ManyToOne, OneToMany, OneToOne, ManyToMany, Enum, Unique, Index } from '@mikro-orm/decorators/es';

function normErr(e:any){ if(e&&typeof e.errno!=='undefined'&&(typeof e.code!=='string'||e.code.startsWith('ERR_'))){try{e.code=String(e.errno)}catch{}} return e; }
class BunReserved implements DatabaseConnection {
  constructor(private readonly r:any){}
  async executeQuery<R>(cq:CompiledQuery):Promise<QueryResult<R>>{ try{ const res:any=await this.r.unsafe(cq.sql,[...cq.parameters]); const rows=Array.isArray(res)?res as R[]:[]; const out:QueryResult<R>={rows}; if(res?.affectedRows!=null)(out as any).numAffectedRows=BigInt(res.affectedRows); if(res?.lastInsertRowid!=null)(out as any).insertId=BigInt(res.lastInsertRowid); return out; }catch(e){throw normErr(e)} }
  async *streamQuery<R>():AsyncIterableIterator<QueryResult<R>>{ throw new Error('streaming unsupported (Bun.SQL has no cursor)'); }
  async release(){ await this.r.release(); }
}
class BunPgKyselyDriver implements Driver {
  private sql:any; constructor(private url:string, private max:number){}
  async init(){ this.sql=new Bun.SQL(this.url,{max:this.max}); }
  async acquireConnection(){ return new BunReserved(await this.sql.reserve()); }
  async beginTransaction(c:DatabaseConnection,s?:any){ if(s?.isolationLevel)await c.executeQuery(CompiledQuery.raw(`set transaction isolation level ${s.isolationLevel}`)); if(s?.accessMode)await c.executeQuery(CompiledQuery.raw(`set transaction ${s.accessMode}`)); await c.executeQuery(CompiledQuery.raw('begin')); }
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

/** The ONLY thing the user injects (via zipbul's own inject()). Context-aware em + repo. */
export function MikroOrm(options: Options<any> & { connection?: string }) {
  const conn = options.connection ?? 'default';
  abstract class MikroOrmService {
    orm!: MikroORM;
    async onInit(){ this.orm = await MikroORM.init(options as any); }       // init only (non-destructive)
    async onDestroy(){ await this.orm?.close(true); }
    /** per-request forked EM (RequestContext) or global */
    get em(): EntityManager { return (RequestContext.getEntityManager(conn) as EntityManager) ?? this.orm.em; }
    /** repository bound to the current (request or global) EM */
    repo<T extends object>(e: EntityName<T>): EntityRepository<T> { return this.em.getRepository<T>(e); }
    /** enter per-request context — call from a defineMiddleware in user src */
    enter(){ RequestContext.enter(this.orm.em); }
  }
  return MikroOrmService;
}
