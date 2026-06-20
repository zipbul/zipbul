import type { DatabaseConnection, QueryResult, CompiledQuery } from 'kysely';

import { MikroOrmError, MikroOrmErrorReason } from '../error';
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
    /**
     * Normalize `bigint` cells in result rows. Enabled for SQLite, where the client runs with
     * Bun.SQL's `safeIntegers` (the only way to avoid precision loss on INTEGER columns past 2^53),
     * which returns EVERY integer as a `bigint`. We collapse safe-range bigints back to `number`
     * (so plain int / PK columns stay numbers) and render out-of-range ones as a decimal `string`
     * (so MikroORM's BigIntType — which stringifies anyway — keeps full precision). No-op for the
     * pooled adapters, whose results carry no bigints.
     */
    private readonly normalizeBigInts = false,
  ) {}

  async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
    try {
      const res = (await this.reserved.unsafe(compiled.sql, [...compiled.parameters])) as
        | (Array<R> & { count?: number | null; affectedRows?: number | null; lastInsertRowid?: number | null })
        | undefined;
      const rows = Array.isArray(res) ? (this.normalizeBigInts ? res.map((r) => this.coerceBigInts(r)) : (res as R[])) : [];
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

  /** Collapse `bigint` cells: safe-range → `number`, out-of-range → decimal `string`. */
  private coerceBigInts<R>(row: R): R {
    if (row === null || typeof row !== 'object') {
      return row;
    }
    let mutated: Record<string, unknown> | undefined;
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      if (typeof value === 'bigint') {
        mutated ??= { ...(row as Record<string, unknown>) };
        mutated[key] =
          value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
            ? Number(value)
            : value.toString();
      }
    }
    return (mutated ?? row) as R;
  }

  // eslint-disable-next-line require-yield
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new MikroOrmError({
      reason: MikroOrmErrorReason.StreamingUnsupported,
      message: 'cursor streaming is unsupported on the Bun.SQL backend (no cursor protocol).',
    });
  }

  async release(): Promise<void> {
    await this.reserved.release();
  }
}
