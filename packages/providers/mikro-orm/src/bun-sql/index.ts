// bun-sql domain barrel — the cross-domain surface consumed by driver/<db>.
// BunSqlConnection / BunSqlKyselyDriver / BunSqlTransactionController are internal Kysely glue,
// constructed only inside this domain, so they are intentionally NOT re-exported.
export { BunSqlDialect } from './bun-sql-dialect';
export { resolveBunSqlUrl } from './build-url';
export type { ConnectionComponents, KyselyDialectParts, BunSqlDialectOptions, ErrorNormalizer } from './interfaces';
export type { BunSqlClient, ReservedConnection, SqlDialectKind } from './types';
// DEFAULT_POOL_MAX is intentionally internal (not re-exported).
