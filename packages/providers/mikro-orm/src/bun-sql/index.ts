// Dialect domain barrel — full cross-domain surface consumed by driver/<db>.
export { BunSqlDialect } from './bun-sql-dialect';
export { BunSqlConnection } from './bun-sql-connection';
export { BunSqlKyselyDriver } from './bun-sql-kysely-driver';
export { BunSqlTransactionController } from './bun-sql-transaction';
export { resolveBunSqlUrl } from './build-url';
export type { ConnectionComponents } from './build-url';
export type { KyselyDialectParts, BunSqlDialectOptions, ErrorNormalizer } from './interfaces';
export type { BunSqlClient, ReservedConnection, SqlDialectKind } from './types';
// DEFAULT_POOL_MAX is intentionally internal (not re-exported).
