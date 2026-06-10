import { AbstractSqlDriver } from '@mikro-orm/sql';
import type { MySqlPlatform } from '@mikro-orm/mysql';
import { Utils } from '@mikro-orm/core';

import { BunMySqlPlatform } from './mysql.platform';
import type {
  Configuration,
  EntityDictionary,
  EntityName,
  FilterQuery,
  NativeInsertUpdateManyOptions,
  QueryResult,
  Transaction,
  UpsertManyOptions,
} from '@mikro-orm/core';

import { BunMySqlConnection } from './mysql.connection';

/**
 * MikroORM MySQL driver backed by Bun's native Bun.SQL (zero `mysql2` dependency).
 * Uses {@link BunMySqlPlatform} (the official {@link MySqlPlatform} with JSON auto-parsing
 * disabled, since Bun.SQL returns JSON columns as raw strings).
 *
 * MySQL has no RETURNING, so a multi-row INSERT reports only the first auto-increment id.
 * `nativeInsertMany`/`nativeUpdateMany` are overridden (mirroring the official MySqlDriver)
 * to reconstruct each row's PK from `insertId + idx * auto_increment_increment`, so a batch
 * flush of several new entities assigns each its own id instead of throwing.
 */
export class BunMySqlDriver extends AbstractSqlDriver<BunMySqlConnection, MySqlPlatform> {
  private autoIncrementIncrement?: number;

  constructor(config: Configuration) {
    super(config, new BunMySqlPlatform(), BunMySqlConnection, ['kysely']);
  }

  private async getAutoIncrementIncrement(ctx?: Transaction): Promise<number> {
    if (this.autoIncrementIncrement == null) {
      // the increment step may differ in a cluster — see mikro-orm#3828
      const res = (await this.connection.execute(
        `show variables like 'auto_increment_increment'`,
        [],
        'get',
        ctx,
        { enabled: false } as never,
      )) as { Value?: string } | undefined;
      this.autoIncrementIncrement = res?.Value ? +res.Value : 1;
    }
    return this.autoIncrementIncrement;
  }

  override async nativeInsertMany<T extends object>(
    entityName: EntityName<T>,
    data: EntityDictionary<T>[],
    options: NativeInsertUpdateManyOptions<T> = {},
  ): Promise<QueryResult<T>> {
    options.processCollections ??= true;
    const res = await super.nativeInsertMany(entityName, data, options);
    const pk = this.primaryKeyField(entityName);
    const inc = await this.getAutoIncrementIncrement(options.ctx);
    const r = res as unknown as MutableResult;
    const rows = r.rows ?? [];
    const insertId = Number(r.insertId ?? 0);
    data.forEach((item, idx) => {
      rows[idx] = { [pk]: (item as Record<string, unknown>)[pk] ?? insertId + idx * inc };
    });
    r.rows = rows;
    r.row = rows[0];
    return res;
  }

  override async nativeUpdateMany<T extends object>(
    entityName: EntityName<T>,
    where: FilterQuery<T>[],
    data: EntityDictionary<T>[],
    options: NativeInsertUpdateManyOptions<T> & UpsertManyOptions<T> = {},
  ): Promise<QueryResult<T>> {
    const res = await super.nativeUpdateMany(entityName, where, data, options);
    const pk = this.primaryKeyField(entityName);
    const inc = await this.getAutoIncrementIncrement(options.ctx);
    const r = res as unknown as MutableResult;
    const insertId = r.insertId;
    let i = 0;
    const rows = where.map((cond) => {
      const c = cond as Record<string, unknown>;
      if (insertId != null && Utils.isEmpty(cond)) {
        return { [pk]: Number(insertId) + i++ * inc };
      }
      if (c[pk] == null) {
        return undefined;
      }
      return { [pk]: c[pk] };
    });
    if (rows.every((row) => row !== undefined)) {
      r.rows = rows as Record<string, unknown>[];
    }
    r.row = r.rows?.[0];
    return res;
  }

  /** The single-column primary key field name for an entity. */
  private primaryKeyField<T extends object>(entityName: EntityName<T>): string {
    const meta = this.metadata.get(entityName);
    const pk = this.getPrimaryKeyFields(meta)[0];
    /* v8 ignore next */
    if (pk == null) {
      throw new Error('@zipbul/mikro-orm: BunMySqlDriver batch ops require a single-column primary key.');
    }
    return pk;
  }
}

/** Loose view of the inherited `QueryResult` for the post-insert PK back-fill mutation. */
interface MutableResult {
  rows: Record<string, unknown>[] | undefined;
  row: Record<string, unknown> | undefined;
  insertId: number | bigint | undefined;
}
