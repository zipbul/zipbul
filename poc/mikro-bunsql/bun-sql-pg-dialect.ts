import {
  type Dialect, type Driver, type DatabaseConnection, type QueryResult,
  type DatabaseIntrospector, type QueryCompiler, type DialectAdapter, type Kysely,
  PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, CompiledQuery,
} from 'kysely';

/** Wraps a *reserved* Bun.SQL connection so raw begin/commit are allowed under pooling. */
class BunSqlReservedConnection implements DatabaseConnection {
  constructor(private readonly reserved: any) {}
  async executeQuery<R>(cq: CompiledQuery): Promise<QueryResult<R>> {
    const res: any = await this.reserved.unsafe(cq.sql, [...cq.parameters]);
    const rows = Array.isArray(res) ? (res as R[]) : [];
    const out: QueryResult<R> = { rows };
    if (res?.affectedRows != null) (out as any).numAffectedRows = BigInt(res.affectedRows);
    return out;
  }
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> { throw new Error('no stream in PoC'); }
  async release(): Promise<void> { await this.reserved.release(); }
}

class BunSqlPgDriver implements Driver {
  private sql: any;
  constructor(private readonly url: string, private readonly poolMax: number) {}
  async init() { this.sql = new Bun.SQL(this.url, { max: this.poolMax }); }
  async acquireConnection() { return new BunSqlReservedConnection(await this.sql.reserve()); }
  async beginTransaction(c: DatabaseConnection) { await c.executeQuery(CompiledQuery.raw('begin')); }
  async commitTransaction(c: DatabaseConnection) { await c.executeQuery(CompiledQuery.raw('commit')); }
  async rollbackTransaction(c: DatabaseConnection) { await c.executeQuery(CompiledQuery.raw('rollback')); }
  async releaseConnection(c: DatabaseConnection) { await (c as BunSqlReservedConnection).release(); }
  async savepoint(c: DatabaseConnection, name: string) { await c.executeQuery(CompiledQuery.raw(`savepoint "${name}"`)); }
  async rollbackToSavepoint(c: DatabaseConnection, name: string) { await c.executeQuery(CompiledQuery.raw(`rollback to savepoint "${name}"`)); }
  async releaseSavepoint(c: DatabaseConnection, name: string) { await c.executeQuery(CompiledQuery.raw(`release savepoint "${name}"`)); }
  async destroy() { await this.sql?.close?.(); }
}

export class BunSqlPgDialect implements Dialect {
  constructor(private readonly url: string, private readonly poolMax = 10) {}
  createDriver(): Driver { return new BunSqlPgDriver(this.url, this.poolMax); }
  createQueryCompiler(): QueryCompiler { return new PostgresQueryCompiler(); }
  createAdapter(): DialectAdapter { return new PostgresAdapter(); }
  createIntrospector(db: Kysely<any>): DatabaseIntrospector { return new PostgresIntrospector(db); }
}
