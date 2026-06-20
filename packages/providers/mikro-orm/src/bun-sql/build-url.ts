import { MikroOrmError, MikroOrmErrorReason } from '../error';
import type { SqlDialectKind } from './types';

/**
 * Connection components MikroORM resolves (via `getConnectionOptions()`) from EITHER a
 * `clientUrl` OR discrete `host`/`port`/`user`/`password`/`dbName` config. `user`/`password` may be
 * a function in MikroORM's contract (e.g. IAM token rotation) — see {@link requireStringCredential}.
 */
export interface ConnectionComponents {
  readonly host?: string;
  readonly port?: number;
  readonly user?: string | (() => unknown);
  readonly password?: string | (() => unknown);
  readonly database?: string;
}

const SCHEME: Record<SqlDialectKind, string> = { postgres: 'postgres', mysql: 'mysql', sqlite: 'sqlite' };

/**
 * MikroORM allows a function `user`/`password` (async credential, e.g. IAM token rotation). The
 * official drivers await it per physical connection. We build the Bun.SQL connection URL
 * synchronously (Kysely's `Dialect` API has no async hook at this point), so a function credential
 * cannot be resolved here — fail loudly instead of stringifying the function into a bogus credential.
 */
function requireStringCredential(value: string | (() => unknown) | undefined, kind: string): string | undefined {
  if (typeof value === 'function') {
    throw new MikroOrmError({
      reason: MikroOrmErrorReason.FunctionCredentialUnsupported,
      message: `a function/async ${kind} is not supported on the Bun.SQL backend — the connection URL is built synchronously. Pre-resolve it to a string before passing it to MikroORM.init.`,
    });
  }
  return value;
}

/**
 * Resolves the Bun.SQL connection URL for a pooled (postgres/mysql) driver.
 *
 * The URL is always assembled from the components MikroORM already resolved via
 * `getConnectionOptions()` — which honours BOTH a `clientUrl` AND discrete
 * `host`/`port`/`user`/`password`/`dbName` config (discrete wins). The original `clientUrl`'s
 * query string (e.g. `?sslmode=require`) is preserved on top. Rebuilding (rather than passing
 * a possibly-defaulted `clientUrl` straight through) is what makes the discrete host/port form
 * actually take effect, since MikroORM fills a default `clientUrl` when none is given.
 *
 * Every interpolated component is percent-encoded so a credential or database name containing
 * URL-significant characters (`@ : / ? #`) cannot truncate or re-route the URL when Bun.SQL reparses
 * it; an IPv6 host is bracketed.
 */
export function resolveBunSqlUrl(
  dialect: SqlDialectKind,
  clientUrl: string | undefined,
  components: ConnectionComponents,
): string {
  const { host = '127.0.0.1', port, database } = components;
  const user = requireStringCredential(components.user, 'user');
  const password = requireStringCredential(components.password, 'password');
  const auth = user ? `${encodeURIComponent(user)}${password ? `:${encodeURIComponent(password)}` : ''}@` : '';
  const portPart = port ? `:${port}` : '';
  const hostPart = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const dbPart = database ? `/${encodeURIComponent(database)}` : '';
  const queryIdx = clientUrl?.indexOf('?') ?? -1;
  const query = queryIdx >= 0 ? clientUrl!.slice(queryIdx) : '';
  return `${SCHEME[dialect]}://${auth}${hostPart}${portPart}${dbPart}${query}`;
}
