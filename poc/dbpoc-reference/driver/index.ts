import { type Dialect, type Driver, type DatabaseConnection, type QueryResult, type DatabaseIntrospector, type QueryCompiler, type DialectAdapter, type Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, CompiledQuery } from 'kysely';
import { AbstractSqlDriver, AbstractSqlConnection } from '@mikro-orm/sql';
import { PostgreSqlPlatform } from '@mikro-orm/postgresql';
import { MikroORM, type Options } from '@mikro-orm/core';
import { SqlSchemaGenerator } from '@mikro-orm/sql';

class BunReserved implements DatabaseConnection {
  constructor(private readonly r: any) {}
  async executeQuery<R>(cq: CompiledQuery): Promise<QueryResult<R>> {
    const res: any = await this.r.unsafe(cq.sql, [...cq.parameters]);
    const rows = Array.isArray(res) ? (res as R[]) : [];
    const out: QueryResult<R> = { rows };
    if (res?.affectedRows != null) (out as any).numAffectedRows = BigInt(res.affectedRows);
    return out;
  }
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> { throw new Error('streaming unsupported'); }
  async release() { await this.r.release(); }
}
class BunPgKyselyDriver implements Driver {
  private sql: any;
  constructor(private url: string, private max: number) {}
  async init() { this.sql = new Bun.SQL(this.url, { max: this.max }); }
  async acquireConnection() { return new BunReserved(await this.sql.reserve()); }
  async beginTransaction(c: DatabaseConnection) { await c.executeQuery(CompiledQuery.raw('begin')); }
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
// ── DI bridge: base service the user extends ──
export abstract class MikroOrmBase {
  orm!: MikroORM;
  protected abstract options(): Options<any>;
  protected async seed(): Promise<void> {}
  async onInit(): Promise<void> {
    this.orm = await MikroORM.init({ extensions: [SqlSchemaGenerator], ...this.options() } as any);
    await this.orm.schema.drop({ dropForeignKeys: true });
    await this.orm.schema.create();
    await this.seed();
  }
  async onDestroy(): Promise<void> { await this.orm?.close(true); }
  get em() { return this.orm.em; }
}
