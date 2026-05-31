import {
  type Dialect, type Driver, type DatabaseConnection, type QueryResult,
  type DatabaseIntrospector, type QueryCompiler, type DialectAdapter, type Kysely,
  SqliteAdapter, SqliteIntrospector, SqliteQueryCompiler, CompiledQuery,
} from 'kysely';

// Bun.SQL-backed connection (the literal "Bun SQL" unified async driver).
class BunSqlConnection implements DatabaseConnection {
  constructor(private readonly sql: any) {}

  async executeQuery<R>(cq: CompiledQuery): Promise<QueryResult<R>> {
    const res: any = await this.sql.unsafe(cq.sql, [...cq.parameters]);
    const rows = Array.isArray(res) ? (res as R[]) : [];
    const out: QueryResult<R> = { rows };
    if (res?.affectedRows != null) (out as any).numAffectedRows = BigInt(res.affectedRows);
    if (res?.lastInsertRowid != null) (out as any).insertId = BigInt(res.lastInsertRowid);
    return out;
  }
  // eslint-disable-next-line require-yield
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('streaming not implemented in PoC');
  }
}

class BunSqlDriver implements Driver {
  private sql: any;
  constructor(private readonly connectionString: string) {}
  async init(): Promise<void> { this.sql = new Bun.SQL(this.connectionString); }
  async acquireConnection(): Promise<DatabaseConnection> { return new BunSqlConnection(this.sql); }
  async beginTransaction(conn: DatabaseConnection): Promise<void> {
    await conn.executeQuery(CompiledQuery.raw('begin'));
  }
  async commitTransaction(conn: DatabaseConnection): Promise<void> {
    await conn.executeQuery(CompiledQuery.raw('commit'));
  }
  async rollbackTransaction(conn: DatabaseConnection): Promise<void> {
    await conn.executeQuery(CompiledQuery.raw('rollback'));
  }
  async releaseConnection(): Promise<void> {}
  async destroy(): Promise<void> { await this.sql?.close?.(); }
}

export class BunSqlDialect implements Dialect {
  constructor(private readonly connectionString: string) {}
  createDriver(): Driver { return new BunSqlDriver(this.connectionString); }
  createQueryCompiler(): QueryCompiler { return new SqliteQueryCompiler(); }
  createAdapter(): DialectAdapter { return new SqliteAdapter(); }
  createIntrospector(db: Kysely<any>): DatabaseIntrospector { return new SqliteIntrospector(db); }
}
