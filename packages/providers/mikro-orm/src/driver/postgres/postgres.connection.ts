import { AbstractSqlConnection } from '@mikro-orm/sql';
import type { Routine, Transaction } from '@mikro-orm/core';
import type { Dialect } from 'kysely';

import {
  BunSqlDialect,
  resolveBunSqlUrl,
  type BunSqlDialectOptions,
  type ConnectionComponents,
} from '../../dialect';
import { POSTGRES_KYSELY_PARTS } from './kysely-parts';
import { PostgresErrorNormalizer } from './postgres.error-normalizer';

/**
 * MikroORM SQL connection for PostgreSQL backed by Bun.SQL. Its only job is to
 * assemble the Bun.SQL-backed Kysely dialect; AbstractSqlConnection handles
 * execute/begin/commit/rollback/transactional on top of it.
 *
 * The URL accepts a full `clientUrl` (query params like `?sslmode=require` preserved) OR
 * discrete `host`/`port`/`user`/`password`/`dbName` config; `pool.max` sets the pool size.
 * `driverOptions` (the `overrides`) are merged on top, so a consumer can override `poolMax`,
 * `pooled`, the `createClient` factory, or the `url`.
 */
export class PostgresConnection extends AbstractSqlConnection {
  override createKyselyDialect(overrides?: Partial<BunSqlDialectOptions>): Dialect {
    const clientUrl = this.config.get('clientUrl') as string | undefined;
    const url = resolveBunSqlUrl('postgres', clientUrl, this.getConnectionOptions() as ConnectionComponents);
    const poolMax = (this.config.get('pool') as { max?: number } | undefined)?.max;
    return new BunSqlDialect(POSTGRES_KYSELY_PARTS, new PostgresErrorNormalizer(), {
      url,
      ...(poolMax != null ? { poolMax } : {}),
      ...overrides,
      dialect: 'postgres',
    });
  }

  /**
   * Invokes a stored routine. Scalar functions go through the inherited `select fn(...)` path;
   * procedures use `call proc(...)`, marshalling scalar OUT params back into their ScalarReference
   * slots and, for refcursor OUT params, FETCHing the cursors (transaction-scoped — hence the
   * fail-fast when no `ctx` is supplied). Mirrors the official PostgreSqlConnection; every step is
   * plain SQL over Bun.SQL (no pg-protocol cursor object required).
   */
  override async callRoutine<T>(
    routine: Routine,
    args: Record<string, unknown> = {},
    ctx?: Transaction,
  ): Promise<T> {
    if (routine.type === 'function') {
      return this.callRoutineFunction<T>(routine, args, ctx);
    }
    const quoted = (id: string): string => this.platform.quoteIdentifier(id);
    const qualified = (routine.schema ? `${quoted(routine.schema)}.` : '') + quoted(routine.name);
    const refcursorParams = routine.params.filter(
      (p) => p.direction !== 'in' && typeof p.type === 'string' && /^refcursor$/i.test(p.type),
    );
    if (refcursorParams.length > 0 && !ctx) {
      throw new Error(
        `Routine ${routine.name} declares refcursor OUT params on PostgreSQL but was not called inside a transaction. Wrap the call in 'em.transactional(...)' so the refcursor OUT params remain valid for FETCH.`,
      );
    }
    const placeholders = routine.params.map(() => '?').join(', ');
    const positional = routine.params.map((p) => this.convertRoutineInbound(args[p.name], p));
    const rows = (await this.execute(
      `call ${qualified}(${placeholders})`,
      positional,
      'all',
      ctx,
    )) as Record<string, unknown>[];
    const row = rows[0] ?? {};
    const scalarOutParams = routine.params.filter((p) => p.direction !== 'in' && !refcursorParams.includes(p));
    this.applyRoutineOutParams(row, scalarOutParams, args);
    if (refcursorParams.length > 0) {
      return this.fetchRefcursors(row, refcursorParams, ctx) as Promise<T>;
    }
    return undefined as T;
  }

  private async fetchRefcursors(
    row: Record<string, unknown>,
    refcursorParams: Routine['params'],
    ctx?: Transaction,
  ): Promise<unknown[][]> {
    const cursorNames = refcursorParams
      .map((p) => row[p.name])
      .filter((name): name is string => typeof name === 'string');
    const sets: unknown[][] = [];
    for (const cursorName of cursorNames) {
      const fetched = (await this.execute(
        `fetch all from "${cursorName.replaceAll('"', '""')}"`,
        [],
        'all',
        ctx,
      )) as unknown[];
      sets.push(fetched);
    }
    return sets;
  }
}
