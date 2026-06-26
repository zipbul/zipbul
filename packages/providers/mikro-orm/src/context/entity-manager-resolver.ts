import { RequestContext as MikroRequestContext, type EntityManager } from '@mikro-orm/core';

import { ConnectionRegistry, type ConnectionName } from '../connection';

/**
 * Resolves the EntityManager a caller should use right now: the per-request fork
 * bound to the AsyncLocalStorage context if one is active, else the connection's
 * global EM. Static so it is reachable from DI-constructed instances without injection.
 */
export class EntityManagerResolver {
  static resolve(name: ConnectionName): EntityManager {
    const scoped = MikroRequestContext.getEntityManager(name);
    return scoped ?? ConnectionRegistry.get(name).em;
  }
}
