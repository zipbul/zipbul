import type { EntityName, EntityRepository } from '@mikro-orm/core';

import { DEFAULT_CONNECTION, type ConnectionName } from '../connection';
import { EntityManagerResolver } from '../context';

/**
 * Repository base. A user subclasses this as an `@Injectable` `XxxRepository` and
 * fills the abstract `entity`; then `inject(XxxRepository)` works like NestJS's
 * `@InjectRepository`.
 *
 * The constructor returns a Proxy: user-defined methods on the subclass win; any
 * other access is delegated to `EntityManagerResolver.resolve(connection).getRepository(entity)`,
 * which yields the current (per-request forked) repository — transparent isolation.
 */
export abstract class BaseRepository<T extends object> {
  protected abstract readonly entity: EntityName<T>;
  protected readonly connection: ConnectionName = DEFAULT_CONNECTION;

  constructor() {
    return new Proxy(this, {
      get(target, prop, receiver) {
        // Never delegate own/inherited members, `then` (so awaiting/DI-resolving the instance
        // does not trigger repository resolution as a thenable side-effect), or symbol keys.
        if (prop === 'then' || typeof prop === 'symbol' || prop in target) {
          return Reflect.get(target, prop, receiver);
        }
        const self = target as BaseRepository<T>;
        const repo = EntityManagerResolver.resolve(self.connection).getRepository<T>(self.entity);
        const value = (repo as unknown as Record<PropertyKey, unknown>)[prop];
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(repo) : value;
      },
    });
  }
}

// The Proxy makes a subclass instance behave as an EntityRepository<T>; surface that.
export interface BaseRepository<T extends object> extends EntityRepository<T> {}
