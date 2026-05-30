import type { ConnectionName } from './types';

/** Thrown when an EntityManager is resolved for a connection that was never registered. */
export class ConnectionNotRegisteredError extends Error {
  constructor(name: ConnectionName) {
    super(`@zipbul/mikro-orm: connection '${name}' is not registered (did its MikroOrmService init run?).`);
    this.name = 'ConnectionNotRegisteredError';
  }
}
