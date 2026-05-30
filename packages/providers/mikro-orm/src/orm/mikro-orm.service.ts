import { MikroORM, type EntityManager } from '@mikro-orm/core';

import { ConnectionRegistry, DEFAULT_CONNECTION, type ConnectionName } from '../connection';
import { EntityManagerResolver, RequestContextRunner } from '../context';
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
    this.orm = await MikroORM.init(this.options);
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
