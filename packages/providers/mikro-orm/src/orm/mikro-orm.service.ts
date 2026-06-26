import { MikroORM, type EntityManager } from '@mikro-orm/core';

import { ConnectionRegistry, DEFAULT_CONNECTION, type ConnectionName } from '../connection';
import { EntityManagerResolver, RequestContextRunner } from '../context';
import { MikroOrmError, MikroOrmErrorReason } from '../error';
import type { ZipbulMikroOrmOptions } from './interfaces';

/**
 * DI bridge base. A user subclasses this as an `@Injectable` `Database` and fills the
 * abstract `options`. Lifecycle is NON-DESTRUCTIVE: onInit only initializes MikroORM
 * and registers the connection — it never drops/creates schema. Schema generation and
 * migrations are explicit, opt-in operations performed elsewhere.
 */
export abstract class MikroOrmService {
  protected abstract readonly options: ZipbulMikroOrmOptions;

  orm!: MikroORM;

  private get connection(): ConnectionName {
    return this.options.connection ?? DEFAULT_CONNECTION;
  }

  async onInit(): Promise<void> {
    // Bind MikroORM's RequestContext key (contextName) to our logical connection name. MikroORM
    // stores the per-request fork in AsyncLocalStorage keyed by `em.name` (= contextName), and
    // EntityManagerResolver looks it up by the connection name — without this, every non-default
    // connection forks under 'default', so its scoped lookup misses and silently falls back to the
    // shared global EM (cross-request identity-map leak). `connection` is our own option, not a
    // MikroORM one, so it is stripped before init.
    // Fail fast on a duplicate connection name BEFORE building a second MikroORM — otherwise the
    // registry would silently drop (and leak) the previously-registered instance's pool.
    if (ConnectionRegistry.has(this.connection)) {
      throw new MikroOrmError({
        reason: MikroOrmErrorReason.ConnectionAlreadyRegistered,
        message: `connection '${this.connection}' is already registered — each connection name must have a single MikroOrmService.`,
      });
    }
    const { connection: _connection, ...mikroOptions } = this.options;
    this.orm = await MikroORM.init({ ...mikroOptions, contextName: this.connection });
    ConnectionRegistry.set(this.connection, this.orm);
  }

  async onDestroy(): Promise<void> {
    ConnectionRegistry.delete(this.connection);
    await this.orm?.close(true);
  }

  /** The EntityManager for the current request (forked) or the global one. */
  get em(): EntityManager {
    return EntityManagerResolver.resolve(this.connection);
  }

  /** Enter a per-request context. Call from a request middleware. */
  enter(): void {
    RequestContextRunner.enter(this.connection);
  }
}
