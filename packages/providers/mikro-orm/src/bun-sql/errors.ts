/**
 * Thrown by {@link BunSqlConnection.streamQuery}. Bun.SQL exposes no cursor, so
 * MikroORM/Kysely streaming cannot be supported; the method exists to satisfy the
 * Kysely `DatabaseConnection` contract but fails explicitly instead of hanging.
 */
export class StreamingUnsupportedError extends Error {
  constructor() {
    super('@zipbul/mikro-orm: streaming is unsupported (Bun.SQL exposes no cursor).');
    this.name = 'StreamingUnsupportedError';
  }
}
