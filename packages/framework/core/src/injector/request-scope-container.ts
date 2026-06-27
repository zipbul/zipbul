import type { ZipbulContainer, ProviderToken } from '@zipbul/common';

import type { Container } from './container';
import type { ContainerValue, ProviderRegistration, Token } from './types';

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
    private readonly requestOverrides?: ReadonlyMap<Token, ProviderRegistration>,
  ) {}

  get(token: Token): ContainerValue {
    if (this.requestOverrides !== undefined) {
      const override = this.requestOverrides.get(token);
      if (override !== undefined) {
        if (this.requestInstances.has(token)) {
          return this.requestInstances.get(token);
        }
        const instance = override.factory(this);
        this.requestInstances.set(token, instance);
        return instance;
      }
    }

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

  set<TValue extends ContainerValue = ContainerValue>(_token: ProviderToken, _factory: (container: ZipbulContainer) => TValue): void {
    throw new Error('[Zipbul DI] Cannot register providers on a request-scoped container. Register providers at module level.');
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
        try {
          await instance.onDestroy();
        } catch {
          // Best-effort: continue disposing remaining instances
        }
      }
    }

    this.requestInstances.clear();
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private hasOnDestroy(instance: ContainerValue): instance is ContainerValue & { onDestroy(): Promise<void> | void } {
    if (!this.isRecord(instance)) {
      return false;
    }

    return 'onDestroy' in instance && typeof instance.onDestroy === 'function';
  }
}
