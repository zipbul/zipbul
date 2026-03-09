import type { ZipbulContainer, ProviderToken } from '@zipbul/common';

import type { Container } from './container';
import type { ContainerValue, Token } from './types';

/**
 * Request-scoped child container that delegates singleton/transient to the parent
 * and caches request-scoped instances per contextId.
 *
 * @public
 */
export class RequestScopeContainer implements ZipbulContainer {
  private requestInstances = new Map<Token, ContainerValue>();

  constructor(
    private readonly parent: Container,
    private readonly contextId: string,
  ) {}

  get(token: Token): ContainerValue {
    const registration = this.parent.getRegistration(token);

    if (!registration) {
      return this.parent.get(token);
    }

    if (registration.scope === 'singleton') {
      return this.parent.get(token);
    }

    if (registration.scope === 'transient') {
      return registration.factory(this);
    }

    if (this.requestInstances.has(token)) {
      return this.requestInstances.get(token);
    }

    const instance = registration.factory(this);

    this.requestInstances.set(token, instance);

    return instance;
  }

  set<TValue extends ContainerValue = ContainerValue>(token: ProviderToken, factory: (container: ZipbulContainer) => TValue): void {
    this.parent.set(token, factory);
  }

  has(token: Token): boolean {
    return this.parent.has(token);
  }

  keys(): IterableIterator<Token> {
    return this.parent.keys();
  }

  getInstances(): IterableIterator<ContainerValue> {
    return this.requestInstances.values();
  }

  /**
   * Returns the unique context identifier for this request scope.
   *
   * @returns The context ID string
   * @public
   */
  getContextId(): string {
    return this.contextId;
  }

  /**
   * Disposes request-scoped instances by calling onDestroy on each.
   *
   * @public
   */
  async dispose(): Promise<void> {
    const instances = Array.from(this.requestInstances.values()).reverse();

    for (const instance of instances) {
      if (this.hasOnDestroy(instance)) {
        await instance.onDestroy();
      }
    }

    this.requestInstances.clear();
  }

  private hasOnDestroy(instance: ContainerValue): instance is ContainerValue & { onDestroy(): Promise<void> | void } {
    return (
      typeof instance === 'object' &&
      instance !== null &&
      'onDestroy' in instance &&
      typeof (instance as Record<string, unknown>).onDestroy === 'function'
    );
  }
}
