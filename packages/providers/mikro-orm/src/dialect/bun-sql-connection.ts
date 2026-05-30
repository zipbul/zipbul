import type { DatabaseConnection, QueryResult, CompiledQuery } from 'kysely';

import { StreamingUnsupportedError } from './errors';
import type { ErrorNormalizer } from './interfaces';
import type { ReservedConnection } from './types';

/**
 * Kysely `DatabaseConnection` over a single reserved Bun.SQL connection.
 *
 * Single responsibility: run one compiled query on the reserved connection, map
 * the Bun.SQL result into Kysely's `QueryResult` shape, and normalize errors so
 * MikroORM's official ExceptionConverter can match them.
 */
export class BunSqlConnection implements DatabaseConnection {
  constructor(
    private readonly reserved: ReservedConnection,
    private readonly errorNormalizer: ErrorNormalizer,
  ) {}

  async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
    try {
      const res = (await this.reserved.unsafe(compiled.sql, [...compiled.parameters])) as
        | (Array<R> & { affectedRows?: number; lastInsertRowid?: number })
        | undefined;
      const rows = Array.isArray(res) ? (res as R[]) : [];
      return {
        rows,
        ...(res?.affectedRows != null ? { numAffectedRows: BigInt(res.affectedRows) } : {}),
        ...(res?.lastInsertRowid != null ? { insertId: BigInt(res.lastInsertRowid) } : {}),
      };
    } catch (error) {
      throw this.errorNormalizer.normalize(error);
    }
  }

  // eslint-disable-next-line require-yield
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new StreamingUnsupportedError();
  }

  async release(): Promise<void> {
    await this.reserved.release();
  }
}
