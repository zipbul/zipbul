import { CompiledQuery, type DatabaseConnection, type TransactionSettings } from 'kysely';

import { MikroOrmError, MikroOrmErrorReason } from '../error';
import type { SqlDialectKind } from './types';

const ISOLATION_LEVELS = new Set(['read uncommitted', 'read committed', 'repeatable read', 'serializable']);
const ACCESS_MODES = new Set(['read only', 'read write']);

/**
 * Owns transaction + savepoint semantics for the Bun.SQL Kysely driver.
 *
 * Single responsibility: translate Kysely's transaction control calls into the
 * correct SQL on a reserved connection — isolation level / access mode mapping on
 * begin, and savepoint name handling for nested transactions. Kept separate from
 * connection-pool lifecycle (which lives in {@link BunSqlKyselyDriver}).
 *
 * The begin sequence is engine-specific because attaching an isolation level to a
 * transaction differs per database:
 *  - postgres: `SET TRANSACTION` issued BEFORE `BEGIN` is silently ignored (the
 *    transaction runs at the session default), so the mode is composed into `BEGIN`.
 *  - mysql: `SET TRANSACTION ISOLATION LEVEL` must be issued BEFORE `START TRANSACTION`;
 *    the access mode is supplied inline on `START TRANSACTION`.
 *  - sqlite: no per-transaction isolation/access mode (serializable via file locking);
 *    any requested mode is ignored and a plain `BEGIN` is opened.
 */
export class BunSqlTransactionController {
  constructor(private readonly dialect: SqlDialectKind) {}

  async begin(connection: DatabaseConnection, settings: TransactionSettings): Promise<void> {
    const isolation = this.validated(settings.isolationLevel, ISOLATION_LEVELS, 'isolation level');
    const accessMode = this.validated(settings.accessMode, ACCESS_MODES, 'access mode');

    if (this.dialect === 'postgres') {
      const clause = ['begin'];
      if (isolation) clause.push(`isolation level ${isolation}`);
      if (accessMode) clause.push(accessMode);
      await connection.executeQuery(CompiledQuery.raw(clause.join(' ')));
      return;
    }

    if (this.dialect === 'mysql') {
      if (isolation) {
        await connection.executeQuery(CompiledQuery.raw(`set transaction isolation level ${isolation}`));
      }
      await connection.executeQuery(CompiledQuery.raw(accessMode ? `start transaction ${accessMode}` : 'begin'));
      return;
    }

    // sqlite: isolation level / access mode are not expressible — open a plain transaction.
    await connection.executeQuery(CompiledQuery.raw('begin'));
  }

  async commit(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('commit'));
  }

  async rollback(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('rollback'));
  }

  async savepoint(connection: DatabaseConnection, name: string): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw(`savepoint ${this.quoteIdentifier(name)}`));
  }

  async rollbackToSavepoint(connection: DatabaseConnection, name: string): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw(`rollback to savepoint ${this.quoteIdentifier(name)}`));
  }

  async releaseSavepoint(connection: DatabaseConnection, name: string): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw(`release savepoint ${this.quoteIdentifier(name)}`));
  }

  /**
   * Quote a savepoint identifier per dialect, doubling the embedded quote char so the identifier
   * boundary holds. MySQL/MariaDB parse a double-quoted token as a string literal under the default
   * `sql_mode` (no `ANSI_QUOTES`), so `SAVEPOINT "x"` is a syntax error — they require backticks.
   * Postgres/SQLite use standard double quotes.
   */
  private quoteIdentifier(name: string): string {
    if (this.dialect === 'mysql') {
      return `\`${name.replace(/`/g, '``')}\``;
    }
    return `"${name.replace(/"/g, '""')}"`;
  }

  /**
   * Whitelist a transaction-mode token before it is interpolated into raw SQL. The values
   * come from Kysely's `TransactionSettings` (driven by MikroORM), but validating them
   * keeps an unexpected/crafted value from reaching the connection and surfaces typos.
   */
  private validated(value: string | undefined, allowed: ReadonlySet<string>, label: string): string | undefined {
    if (!value) return undefined;
    const normalized = value.toLowerCase();
    if (!allowed.has(normalized)) {
      throw new MikroOrmError({
        reason: MikroOrmErrorReason.UnsupportedTransactionMode,
        message: `unsupported transaction ${label} "${value}".`,
      });
    }
    return normalized;
  }
}
