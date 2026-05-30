import { CompiledQuery, type DatabaseConnection, type TransactionSettings } from 'kysely';

/**
 * Owns transaction + savepoint semantics for the Bun.SQL Kysely driver.
 *
 * Single responsibility: translate Kysely's transaction control calls into the
 * correct SQL on a reserved connection — isolation level / access mode mapping on
 * begin, and savepoint name handling for nested transactions. Kept separate from
 * connection-pool lifecycle (which lives in {@link BunSqlKyselyDriver}).
 */
export class BunSqlTransactionController {
  async begin(connection: DatabaseConnection, settings: TransactionSettings): Promise<void> {
    if (settings.isolationLevel) {
      await connection.executeQuery(
        CompiledQuery.raw(`set transaction isolation level ${settings.isolationLevel}`),
      );
    }
    if (settings.accessMode) {
      await connection.executeQuery(CompiledQuery.raw(`set transaction ${settings.accessMode}`));
    }
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

  /** Quote a savepoint identifier, doubling embedded quotes so the identifier boundary holds. */
  private quoteIdentifier(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }
}
