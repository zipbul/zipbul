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
        | (Array<R> & { count?: number | null; affectedRows?: number | null; lastInsertRowid?: number | null })
        | undefined;
      const rows = Array.isArray(res) ? (res as R[]) : [];
      // Bun.SQL reports the affected row count differently per adapter: mysql uses
      // `.affectedRows` (and sets `.count` to 0), while pg leaves `.affectedRows` null and
      // carries the count on `.count`. Prefer `.affectedRows`, falling back to `.count`.
      const affected = res?.affectedRows ?? res?.count;
      return {
        rows,
        ...(affected != null ? { numAffectedRows: BigInt(affected) } : {}),
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
