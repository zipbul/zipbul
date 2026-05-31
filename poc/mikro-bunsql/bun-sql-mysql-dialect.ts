import {
  type Dialect, type Driver, type DatabaseConnection, type QueryResult,
  type DatabaseIntrospector, type QueryCompiler, type DialectAdapter, type Kysely,
  MysqlAdapter, MysqlIntrospector, MysqlQueryCompiler, CompiledQuery,
} from 'kysely';

class BunReserved implements DatabaseConnection {
  constructor(private readonly r: any) {}
  async executeQuery<R>(cq: CompiledQuery): Promise<QueryResult<R>> {
    const res: any = await this.r.unsafe(cq.sql, [...cq.parameters]);
    const rows = Array.isArray(res) ? (res as R[]) : [];
    const out: QueryResult<R> = { rows };
    if (res?.affectedRows != null) (out as any).numAffectedRows = BigInt(res.affectedRows);
    if (res?.lastInsertRowid != null) (out as any).insertId = BigInt(res.lastInsertRowid);
    return out;
  }
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> { throw new Error('no stream'); }
  async release() { await this.r.release(); }
}
class BunMysqlDriver implements Driver {
  private sql: any;
  constructor(private url: string, private max: number) {}
  async init() { this.sql = new Bun.SQL(this.url, { max: this.max }); }
  async acquireConnection() { return new BunReserved(await this.sql.reserve()); }
  async beginTransaction(c: DatabaseConnection) { await c.executeQuery(CompiledQuery.raw('begin')); }
  async commitTransaction(c: DatabaseConnection) { await c.executeQuery(CompiledQuery.raw('commit')); }
  async rollbackTransaction(c: DatabaseConnection) { await c.executeQuery(CompiledQuery.raw('rollback')); }
  async savepoint(c: DatabaseConnection, n: string) { await c.executeQuery(CompiledQuery.raw('savepoint `'+n+'`')); }
  async rollbackToSavepoint(c: DatabaseConnection, n: string) { await c.executeQuery(CompiledQuery.raw('rollback to savepoint `'+n+'`')); }
  async releaseSavepoint(c: DatabaseConnection, n: string) { await c.executeQuery(CompiledQuery.raw('release savepoint `'+n+'`')); }
  async releaseConnection(c: DatabaseConnection) { await (c as BunReserved).release(); }
  async destroy() { await this.sql?.close?.(); }
}
export class BunMysqlDialect implements Dialect {
  constructor(private url: string, private max = 10) {}
  createDriver(): Driver { return new BunMysqlDriver(this.url, this.max); }
  createQueryCompiler(): QueryCompiler { return new MysqlQueryCompiler(); }
  createAdapter(): DialectAdapter { return new MysqlAdapter(); }
  createIntrospector(db: Kysely<any>): DatabaseIntrospector { return new MysqlIntrospector(db); }
}
