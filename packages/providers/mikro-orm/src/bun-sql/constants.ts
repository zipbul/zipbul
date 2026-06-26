import type { SqlDialectKind } from './types';

/** Default Bun.SQL connection pool size when `BunSqlDialectOptions.poolMax` is omitted. */
export const DEFAULT_POOL_MAX = 10;

/** URL scheme per SQL dialect, used to assemble the Bun.SQL connection URL. */
export const SCHEME: Record<SqlDialectKind, string> = { postgres: 'postgres', mysql: 'mysql', sqlite: 'sqlite' };

/** Transaction isolation levels accepted on `begin` (lowercased), whitelisted before raw-SQL interpolation. */
export const ISOLATION_LEVELS: ReadonlySet<string> = new Set([
  'read uncommitted',
  'read committed',
  'repeatable read',
  'serializable',
]);

/** Transaction access modes accepted on `begin` (lowercased), whitelisted before raw-SQL interpolation. */
export const ACCESS_MODES: ReadonlySet<string> = new Set(['read only', 'read write']);
