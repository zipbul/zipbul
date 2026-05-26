// ===== @zipbul/mikro-orm — Bun.SQL MikroORM driver + zipbul-native DX =====
import {
  type Dialect, type Driver, type DatabaseConnection, type QueryResult,
  type DatabaseIntrospector, type QueryCompiler, type DialectAdapter, type Kysely,
  PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, CompiledQuery,
} from 'kysely';
import { AbstractSqlDriver, AbstractSqlConnection } from '@mikro-orm/sql';
import { PostgreSqlPlatform } from '@mikro-orm/postgresql';
import { MikroORM, RequestContext, type Options, type EntityManager, type EntityRepository, type EntityName } from '@mikro-orm/core';

// re-export modern ES entity decorators so users import from ONE place
export { Entity, PrimaryKey, Property, ManyToOne, OneToMany, OneToOne, ManyToMany, Enum, Unique, Index } from '@mikro-orm/decorators/es';

// ---------- Bun.SQL Kysely dialect (pg) with error normalization (B1-a) ----------
function normalizeBunError(e: any): any {
  // pg: Bun puts SQLSTATE in .errno; official PostgreSqlExceptionConverter reads .code
  if (e && typeof e.errno !== 'undefined' && (typeof e.code !== 'string' || e.code.startsWith('ERR_'))) {
    try { e.code = String(e.errno); } catch { /* frozen */ }
  }
  return e;
}
class BunReserved implements DatabaseConnection {
  constructor(private readonly r: any) {}
  async executeQuery<R>(cq: CompiledQuery): Promise<QueryResult<R>> {
    try {
      const res: any = await this.r.unsafe(cq.sql, [...cq.parameters]);
      const rows = Array.isArray(res) ? (res as R[]) : [];
      const out: QueryResult<R> = { rows };
      if (res?.affectedRows != null) (out as any).numAffectedRows = BigInt(res.affectedRows);
      if (res?.lastInsertRowid != null) (out as any).insertId = BigInt(res.lastInsertRowid); // my/sqlite
      return out;
    } catch (e) { throw normalizeBunError(e); }
  }
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> { throw new Error('@zipbul/mikro-orm: streaming unsupported (Bun.SQL has no cursor)'); }
  async release() { await this.r.release(); }
}
class BunPgKyselyDriver implements Driver {
  private sql: any;
  constructor(private url: string, private max: number) {}
  async init() { this.sql = new Bun.SQL(this.url, { max: this.max }); }
  async acquireConnection() { return new BunReserved(await this.sql.reserve()); }
  async beginTransaction(c: DatabaseConnection, settings?: any) {
    if (settings?.isolationLevel) await c.executeQuery(CompiledQuery.raw(`set transaction isolation level ${settings.isolationLevel}`)); // B1-c
    if (settings?.accessMode) await c.executeQuery(CompiledQuery.raw(`set transaction ${settings.accessMode}`));
    await c.executeQuery(CompiledQuery.raw('begin'));
  }
  async commitTransaction(c: DatabaseConnection) { await c.executeQuery(CompiledQuery.raw('commit')); }
  async rollbackTransaction(c: DatabaseConnection) { await c.executeQuery(CompiledQuery.raw('rollback')); }
  async savepoint(c: DatabaseConnection, n: string) { await c.executeQuery(CompiledQuery.raw(`savepoint "${n}"`)); }
  async rollbackToSavepoint(c: DatabaseConnection, n: string) { await c.executeQuery(CompiledQuery.raw(`rollback to savepoint "${n}"`)); }
  async releaseSavepoint(c: DatabaseConnection, n: string) { await c.executeQuery(CompiledQuery.raw(`release savepoint "${n}"`)); }
  async releaseConnection(c: DatabaseConnection) { await (c as BunReserved).release(); }
  async destroy() { await this.sql?.close?.(); }
}
class BunPgDialect implements Dialect {
  constructor(private url: string, private max = 10) {}
  createDriver(): Driver { return new BunPgKyselyDriver(this.url, this.max); }
  createQueryCompiler(): QueryCompiler { return new PostgresQueryCompiler(); }
  createAdapter(): DialectAdapter { return new PostgresAdapter(); }
  createIntrospector(db: Kysely<any>): DatabaseIntrospector { return new PostgresIntrospector(db); }
}
class BunPgConnection extends AbstractSqlConnection {
  createKyselyDialect(): Dialect { return new BunPgDialect(this.config.get('clientUrl') as string); }
}
export class BunPostgreSqlDriver extends AbstractSqlDriver<BunPgConnection, PostgreSqlPlatform> {
  constructor(config: any) { super(config, new PostgreSqlPlatform(), BunPgConnection, ['kysely']); }
}

// ---------- registry (decouples injectRepository from the user's class token) ----------
const registry = new Map<string, MikroORM>();

// ---------- MikroOrm() mixin: base class the user @Injectable-subclasses (B3: init only) ----------
export interface ZipbulMikroOrmOptions extends Options<any> { connection?: string; }
export function MikroOrm(options: ZipbulMikroOrmOptions) {
  const conn = options.connection ?? 'default';
  abstract class MikroOrmService {
    orm!: MikroORM;
    async onInit(): Promise<void> {
      this.orm = await MikroORM.init(options as any);
      registry.set(conn, this.orm);          // non-destructive: NO schema drop/create
    }
    async onDestroy(): Promise<void> { registry.delete(conn); await this.orm?.close(true); }
    /** context-aware EM (per-request fork via RequestContext, else global) */
    get em(): EntityManager { return (RequestContext.getEntityManager(conn) as EntityManager) ?? this.orm.em; }
  }
  return MikroOrmService;
}
function emFor(conn: string): EntityManager {
  const ctx = RequestContext.getEntityManager(conn) as EntityManager | undefined;
  if (ctx) return ctx;
  const orm = registry.get(conn);
  if (!orm) throw new Error(`@zipbul/mikro-orm: connection '${conn}' not initialized`);
  return orm.em;
}

// ---------- zipbul-native injection: request-aware, no provider records needed ----------
/** Returns a repository proxy that resolves the current (request-forked or global) EM per call. */
export function injectRepository<T extends object>(entity: EntityName<T>, connection = 'default'): EntityRepository<T> {
  return new Proxy({} as EntityRepository<T>, {
    get(_t, prop) {
      const repo = emFor(connection).getRepository<T>(entity);
      const v = (repo as any)[prop];
      return typeof v === 'function' ? v.bind(repo) : v;
    },
  });
}
/** Returns an EntityManager proxy that resolves the current (request-forked or global) EM per call. */
export function injectEntityManager(connection = 'default'): EntityManager {
  return new Proxy({} as EntityManager, {
    get(_t, prop) { const em = emFor(connection) as any; const v = em[prop]; return typeof v === 'function' ? v.bind(em) : v; },
  });
}

// ---------- per-request context: handler builder (user wraps in defineMiddleware in their src) ----------
export function enterRequestContext(connection = 'default') {
  return (_ctx: unknown) => {
    const orm = registry.get(connection);
    if (orm) RequestContext.enter(orm.em);
  };
}
