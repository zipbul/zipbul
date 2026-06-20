import type { MikroORM } from '@mikro-orm/core';

import { MikroOrmError, MikroOrmErrorReason } from '../error';
import type { ConnectionName } from './types';

/**
 * Process-global registry mapping a logical connection name to its live MikroORM
 * instance. Static because consumers (BaseRepository subclasses, the EM resolver)
 * are created by zipbul DI without constructor injection and must reach the registry
 * without an instance handle.
 */
export class ConnectionRegistry {
  private static readonly instances = new Map<ConnectionName, MikroORM>();

  static set(name: ConnectionName, orm: MikroORM): void {
    ConnectionRegistry.instances.set(name, orm);
  }

  static get(name: ConnectionName): MikroORM {
    const orm = ConnectionRegistry.instances.get(name);
    if (!orm) {
      throw new MikroOrmError({
        reason: MikroOrmErrorReason.ConnectionNotRegistered,
        message: `connection '${name}' is not registered (did its MikroOrmService init run?).`,
      });
    }
    return orm;
  }

  static has(name: ConnectionName): boolean {
    return ConnectionRegistry.instances.has(name);
  }

  static delete(name: ConnectionName): void {
    ConnectionRegistry.instances.delete(name);
  }
}
