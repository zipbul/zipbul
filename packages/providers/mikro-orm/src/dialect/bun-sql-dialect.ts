import type {
  Dialect,
  Driver,
  QueryCompiler,
  DialectAdapter,
  DatabaseIntrospector,
  Kysely,
} from 'kysely';

import { BunSqlKyselyDriver } from './bun-sql-kysely-driver';
import { DEFAULT_POOL_MAX } from './constants';
import type { KyselyDialectParts, BunSqlDialectOptions, ErrorNormalizer } from './interfaces';
import type { BunSqlClient } from './types';

/**
 * Kysely `Dialect` for Bun.SQL. DB-agnostic: the per-DB Kysely trio
 * ({@link KyselyDialectParts}) and the {@link ErrorNormalizer} are injected by each
 * driver in `driver/<db>`.
 */
export class BunSqlDialect implements Dialect {
  constructor(
    private readonly parts: KyselyDialectParts,
    private readonly errorNormalizer: ErrorNormalizer,
    private readonly options: BunSqlDialectOptions,
  ) {}

  createDriver(): Driver {
    const poolMax = this.options.poolMax ?? DEFAULT_POOL_MAX;
    const pooled = this.options.pooled ?? true;
    const createClient =
      this.options.createClient ??
      ((url: string, max: number): BunSqlClient =>
        (pooled ? new Bun.SQL(url, { max }) : new Bun.SQL(url)) as unknown as BunSqlClient);
    return new BunSqlKyselyDriver(
      this.options.url,
      this.errorNormalizer,
      poolMax,
      createClient,
      pooled,
      this.options.dialect,
    );
  }

  createQueryCompiler(): QueryCompiler {
    return this.parts.createQueryCompiler();
  }

  createAdapter(): DialectAdapter {
    return this.parts.createAdapter();
  }

  createIntrospector(db: Kysely<unknown>): DatabaseIntrospector {
    return this.parts.createIntrospector(db);
  }
}
