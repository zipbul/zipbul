import type { SqlDialectKind } from './types';

/**
 * Connection components MikroORM resolves (via `getConnectionOptions()`) from EITHER a
 * `clientUrl` OR discrete `host`/`port`/`user`/`password`/`dbName` config.
 */
export interface ConnectionComponents {
  readonly host?: string;
  readonly port?: number;
  readonly user?: string;
  readonly password?: string;
  readonly database?: string;
}

const SCHEME: Record<SqlDialectKind, string> = { postgres: 'postgres', mysql: 'mysql', sqlite: 'sqlite' };

/**
 * Resolves the Bun.SQL connection URL for a pooled (postgres/mysql) driver.
 *
 * The URL is always assembled from the components MikroORM already resolved via
 * `getConnectionOptions()` — which honours BOTH a `clientUrl` AND discrete
 * `host`/`port`/`user`/`password`/`dbName` config (discrete wins). The original `clientUrl`'s
 * query string (e.g. `?sslmode=require`) is preserved on top. Rebuilding (rather than passing
 * a possibly-defaulted `clientUrl` straight through) is what makes the discrete host/port form
 * actually take effect, since MikroORM fills a default `clientUrl` when none is given.
 */
export function resolveBunSqlUrl(
  dialect: SqlDialectKind,
  clientUrl: string | undefined,
  components: ConnectionComponents,
): string {
  const { host = '127.0.0.1', port, user, password, database } = components;
  const auth = user ? `${encodeURIComponent(user)}${password ? `:${encodeURIComponent(password)}` : ''}@` : '';
  const portPart = port ? `:${port}` : '';
  const dbPart = database ? `/${database}` : '';
  const queryIdx = clientUrl?.indexOf('?') ?? -1;
  const query = queryIdx >= 0 ? clientUrl!.slice(queryIdx) : '';
  return `${SCHEME[dialect]}://${auth}${host}${portPart}${dbPart}${query}`;
}
