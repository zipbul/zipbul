import { AbstractSqlConnection } from '@mikro-orm/sql';
import type { Routine, Transaction } from '@mikro-orm/core';
import type { Dialect } from 'kysely';

import {
  BunSqlDialect,
  resolveBunSqlUrl,
  type BunSqlDialectOptions,
  type ConnectionComponents,
} from '../../bun-sql';
import { MYSQL_KYSELY_PARTS } from './kysely-parts';
import { MySqlErrorNormalizer } from './mysql.error-normalizer';

/**
 * MikroORM SQL connection for MySQL/MariaDB backed by Bun.SQL. Accepts a full `clientUrl`
 * or discrete `host`/`port`/`user`/`password`/`dbName` config; `pool.max` sets the pool size.
 * `driverOptions` (the `overrides`) are merged on top.
 */
export class MySqlConnection extends AbstractSqlConnection {
  override createKyselyDialect(overrides?: Partial<BunSqlDialectOptions>): Dialect {
    const clientUrl = this.config.get('clientUrl') as string | undefined;
    const url = resolveBunSqlUrl('mysql', clientUrl, this.getConnectionOptions() as ConnectionComponents);
    const poolMax = (this.config.get('pool') as { max?: number } | undefined)?.max;
    return new BunSqlDialect(MYSQL_KYSELY_PARTS, new MySqlErrorNormalizer(), {
      url,
      ...(poolMax != null ? { poolMax } : {}),
      ...overrides,
      dialect: 'mysql',
    });
  }

  /**
   * Invokes a stored routine. Scalar functions use the inherited `select fn(...)` path; procedures
   * use `call proc(...)`, binding OUT/INOUT params to connection-scoped `@vars` and reading them
   * back with a trailing `select`. Because those `@vars` are per-connection, the SET + CALL +
   * SELECT must run on one physical connection — wrapped in an implicit transaction when the
   * caller supplies none. Mirrors the official MySqlConnection.
   */
  override async callRoutine<T>(
    routine: Routine,
    args: Record<string, unknown> = {},
    ctx?: Transaction,
  ): Promise<T> {
    if (routine.type === 'function') {
      return this.callRoutineFunction<T>(routine, args, ctx);
    }
    const name = this.platform.quoteIdentifier(routine.name);
    const callPlaceholders: string[] = [];
    const callValues: unknown[] = [];
    const outVarParams: Array<{ name: string; varName: string; param: Routine['params'][number] }> = [];
    routine.params.forEach((p, i) => {
      if (p.direction === 'in') {
        callPlaceholders.push('?');
        callValues.push(this.convertRoutineInbound(args[p.name], p));
        return;
      }
      const varName = `@_mikro_orm_routine_${i}`;
      outVarParams.push({ name: p.name, varName, param: p });
      callPlaceholders.push(varName);
    });
    const needsConnectionAffinity = outVarParams.length > 0 && !ctx;
    const runSteps = async (sharedCtx?: Transaction): Promise<T> => {
      for (let i = 0; i < routine.params.length; i++) {
        const p = routine.params[i]!;
        if (p.direction === 'inout') {
          const varName = `@_mikro_orm_routine_${i}`;
          await this.execute(
            `set ${varName} := ?`,
            [this.convertRoutineInbound(args[p.name], p)],
            'run',
            sharedCtx,
          );
        }
      }
      const callResult = (await this.execute(
        `call ${name}(${callPlaceholders.join(', ')})`,
        callValues,
        'all',
        sharedCtx,
      )) as unknown[];
      const resultSets = callResult.filter(Array.isArray);
      if (outVarParams.length > 0) {
        const selectClause = outVarParams
          .map((o) => `${o.varName} as ${this.platform.quoteIdentifier(o.name)}`)
          .join(', ');
        const rows = (await this.execute(`select ${selectClause}`, [], 'all', sharedCtx)) as Record<
          string,
          unknown
        >[];
        this.applyRoutineOutParams(
          rows[0] ?? {},
          outVarParams.map((o) => o.param),
          args,
        );
      }
      return (resultSets.length > 0 ? resultSets : undefined) as T;
    };
    if (needsConnectionAffinity) {
      return this.transactional((trx) => runSteps(trx as Transaction));
    }
    return runSteps(ctx);
  }
}
