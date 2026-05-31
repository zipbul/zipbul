import { RequestContext as MikroRequestContext } from '@mikro-orm/core';

import { ConnectionRegistry, type ConnectionName } from '../connection';

/**
 * Enters a MikroORM RequestContext (AsyncLocalStorage) for the current request so
 * that {@link EntityManagerResolver} returns a per-request EM fork. Called from a
 * zipbul middleware at the start of request handling. Static for the same
 * no-injection reason as the resolver.
 */
export class RequestContextRunner {
  static enter(name: ConnectionName): void {
    MikroRequestContext.enter(ConnectionRegistry.get(name).em);
  }
}
