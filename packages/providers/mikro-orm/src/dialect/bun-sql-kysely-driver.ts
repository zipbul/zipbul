import type { Driver, DatabaseConnection, TransactionSettings } from 'kysely';

import { BunSqlConnection } from './bun-sql-connection';
import { BunSqlTransactionController } from './bun-sql-transaction';
import { DEFAULT_POOL_MAX } from './constants';
import type { ErrorNormalizer } from './interfaces';
import type { BunSqlClient, ReservedConnection } from './types';

/**
 * Kysely low-level `Driver` over Bun.SQL.
 *
 * Single responsibility: connection acquisition / release / pool lifecycle. All
 * transaction + savepoint logic is delegated to {@link BunSqlTransactionController}.
 *
 * Pooled adapters (postgres/mysql) check out a reserved connection per acquire; sqlite is
 * a single synchronous connection with no reservation, so it uses the client directly.
 */
export class BunSqlKyselyDriver implements Driver {
  private client: BunSqlClient | undefined;
  private readonly transactions = new BunSqlTransactionController();

  constructor(
    private readonly url: string,
    private readonly errorNormalizer: ErrorNormalizer,
    private readonly poolMax: number = DEFAULT_POOL_MAX,
    private readonly createClient: (url: string, poolMax: number) => BunSqlClient,
    private readonly pooled: boolean = true,
  ) {}

  async init(): Promise<void> {
    this.client = this.createClient(this.url, this.poolMax);
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    if (!this.client) {
      throw new Error('@zipbul/mikro-orm: BunSqlKyselyDriver used before init().');
    }
    if (this.pooled) {
      if (!this.client.reserve) {
        throw new Error('@zipbul/mikro-orm: pooled driver requires a Bun.SQL client with reserve().');
      }
      return new BunSqlConnection(await this.client.reserve(), this.errorNormalizer);
    }
    return new BunSqlConnection(this.directConnection(this.client), this.errorNormalizer);
  }

  /** Single-connection (sqlite) path: run on the client directly; release is a no-op. */
  private directConnection(client: BunSqlClient): ReservedConnection {
    return {
      unsafe: (query, params) => client.unsafe(query, params),
      release: () => {},
    };
  }

  async beginTransaction(
    connection: DatabaseConnection,
    settings: TransactionSettings,
  ): Promise<void> {
    await this.transactions.begin(connection, settings);
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await this.transactions.commit(connection);
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await this.transactions.rollback(connection);
  }

  async savepoint(connection: DatabaseConnection, name: string): Promise<void> {
    await this.transactions.savepoint(connection, name);
  }

  async rollbackToSavepoint(connection: DatabaseConnection, name: string): Promise<void> {
    await this.transactions.rollbackToSavepoint(connection, name);
  }

  async releaseSavepoint(connection: DatabaseConnection, name: string): Promise<void> {
    await this.transactions.releaseSavepoint(connection, name);
  }

  async releaseConnection(connection: DatabaseConnection): Promise<void> {
    await (connection as BunSqlConnection).release();
  }

  async destroy(): Promise<void> {
    await this.client?.close?.();
  }
}
