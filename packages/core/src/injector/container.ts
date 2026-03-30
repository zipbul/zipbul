import type {
  ZipbulContainer,
  ZipbulFactory,
  ZipbulValue,
  Class,
  Provider,
  ProviderToken,
  ProviderScope,
  ProviderVisibleTo,
  ProviderUseClass,
  ProviderUseExisting,
  ProviderUseFactory,
  ProviderUseValue,
} from '@zipbul/common';

import type {
  ContainerValue,
  ConstructorParamMetadata,
  FactoryFn,
  ModuleObject,
  ProviderRegistration,
  ProviderRegistrationOptions,
  Token,
} from './types';

import { getRuntimeContext } from '../runtime/runtime-context';
import {
  normalizeToken,
  formatToken,
  resolveTokenRecord,
} from './token-resolver';
import { RequestScopeContainer } from './request-scope-container';

export class Container implements ZipbulContainer {
  private registrations = new Map<Token, ProviderRegistration>();
  private singletons = new Map<Token, ContainerValue>();
  private registrationOrder: Token[] = [];
  private scopedKeys?: Map<ProviderToken, string>;

  constructor(initialFactories?: Map<Token, FactoryFn>) {
    if (initialFactories) {
      for (const [token, factory] of initialFactories) {
        this.set(token, factory);
      }
    }
  }

  /**
   * Sets the scoped keys map for resolving class/symbol tokens to scoped string keys.
   * Called exclusively by {@link registerRuntimeContext} during AOT bootstrap.
   *
   * @param keys - Map of ProviderToken to scoped key string
   * @internal
   */
  setScopedKeys(keys: Map<ProviderToken, string>): void {
    this.scopedKeys = keys;
  }

  set<TValue extends ZipbulValue = ZipbulValue>(
    token: Token,
    factory: ZipbulFactory<TValue> | FactoryFn,
    options?: ProviderRegistrationOptions,
  ): void {
    const scope: ProviderScope = options?.scope ?? 'singleton';
    const visibleTo: ProviderVisibleTo = options?.visibleTo ?? 'module';

    this.registrations.set(token, { factory: factory as FactoryFn, scope, visibleTo });
    this.registrationOrder.push(token);
  }

  get(token: Token): ContainerValue {
    const resolvedToken = this.resolveToken(token);

    if (this.singletons.has(resolvedToken)) {
      return this.singletons.get(resolvedToken);
    }

    const registration = this.registrations.get(resolvedToken);

    if (!registration) {
      const tokenLabel = formatToken(token);

      throw new Error(`No provider for token: ${tokenLabel}`);
    }

    if (registration.scope === 'request') {
      const tokenLabel = formatToken(token);

      throw new Error(
        `[Zipbul DI] Cannot resolve request-scoped provider '${tokenLabel}' from the root container. Use RequestScopeContainer.`,
      );
    }

    const instance = registration.factory(this);

    if (registration.scope === 'singleton') {
      this.singletons.set(resolvedToken, instance);
    }

    return instance;
  }

  keys(): IterableIterator<Token> {
    return this.registrations.keys();
  }

  has(token: Token): boolean {
    return this.registrations.has(token);
  }

  getInstances(): IterableIterator<ContainerValue> {
    return this.singletons.values();
  }

  /**
   * Returns the registration metadata for a given token.
   * Resolves scoped keys internally before lookup.
   *
   * @param token - The provider token to look up
   * @returns The provider registration, or undefined if not found
   * @public
   */
  getRegistration(token: Token): ProviderRegistration | undefined {
    const resolvedToken = this.resolveToken(token);

    return this.registrations.get(resolvedToken);
  }

  /**
   * Returns the tokens in registration order (used for lifecycle hook ordering).
   *
   * @returns An array of tokens in the order they were registered
   * @public
   */
  getRegistrationOrder(): readonly Token[] {
    return this.registrationOrder;
  }

  /**
   * Creates a request-scoped child container.
   *
   * @param contextId - Unique identifier for this request scope.
   * @returns A scoped container that delegates singletons to this parent.
   */
  createRequestScope(contextId: string): ZipbulContainer {
    return new RequestScopeContainer(this, contextId);
  }

  /**
   * No-op on root container. Request-scoped containers override this.
   */
  async dispose(): Promise<void> {
    // Root container lifecycle is managed by Application.stop()
  }

  async loadDynamicModule(scope: string, dynamicModule: ModuleObject | null | undefined): Promise<void> {
    if (dynamicModule === null || dynamicModule === undefined) {
      return;
    }

    const providers = dynamicModule.providers ?? [];

    for (const provider of providers) {
      let token: Token | undefined;
      let factory: FactoryFn | undefined;

      if (this.isClassProvider(provider)) {
        token = provider;
        factory = _c => new provider(...this.resolveDepsFor(provider, scope));
      } else if (this.isProviderRecord(provider)) {
        token = provider.provide;

        if (this.isProviderUseValue(provider)) {
          factory = () => provider.useValue;
        } else if (this.isProviderUseClass(provider)) {
          factory = _c => new provider.useClass(...this.resolveDepsFor(provider.useClass, scope));
        } else if (this.isProviderUseExisting(provider)) {
          factory = c => {
            const existingKey = normalizeToken(provider.useExisting);
            const hasExistingKey = typeof existingKey === 'string' && existingKey.length > 0;
            const scopedKey = hasExistingKey ? `${scope}::${existingKey}` : '';

            if (scopedKey.length > 0 && c.has(scopedKey)) {
              return c.get(scopedKey);
            }

            if (hasExistingKey) {
              return c.get(existingKey);
            }

            throw new Error(`No existing provider found for alias token: ${formatToken(provider.useExisting)}`);
          };
        } else if (this.isProviderUseFactory(provider)) {
          factory = c => {
            const args = Array.isArray(provider.inject) ? provider.inject.map((dep: ProviderToken) => c.get(dep)) : [];
            const result = provider.useFactory(...args);

            if (result === undefined) {
              return undefined;
            }

            return result;
          };
        }
      }

      const normalizedToken = normalizeToken(token);
      const keyStr = normalizedToken !== undefined ? `${scope}::${normalizedToken}` : '';

      if (keyStr.length > 0 && factory !== undefined) {
        this.set(keyStr, factory);
      }
    }
  }

  private resolveDepsFor(ctor: Class, scope: string): ContainerValue[] {
    const registry = getRuntimeContext().metadataRegistry;

    if (!registry || !registry.has(ctor)) {
      return [];
    }

    const meta = registry.get(ctor);

    if (!meta) {
      return [];
    }

    if (!meta.constructorParams) {
      return [];
    }

    return meta.constructorParams.map((param: ConstructorParamMetadata) => {
      let token = param.type;

      token = resolveTokenRecord(token);

      const tokenName = normalizeToken(token);
      const key = tokenName !== undefined ? `${scope}::${tokenName}` : '';

      if (key.length > 0 && this.has(key)) {
        return this.get(key);
      }

      if (tokenName === undefined) {
        throw new Error(
          `[Zipbul DI] Cannot resolve constructor parameter of '${ctor.name}': token could not be normalized. ` +
          `Ensure the parameter type is a class, string, or symbol registered in the container.`,
        );
      }

      try {
        return this.get(tokenName);
      } catch {
        throw new Error(
          `[Zipbul DI] Cannot resolve constructor parameter of '${ctor.name}': no provider for '${tokenName}'. ` +
          `Register a provider for this token in the module or check the import path.`,
        );
      }
    });
  }

  private isClassProvider(provider: Provider): provider is Class {
    return typeof provider === 'function';
  }

  private isProviderRecord(
    provider: Provider,
  ): provider is ProviderUseValue | ProviderUseClass | ProviderUseExisting | ProviderUseFactory {
    return typeof provider === 'object' && provider !== null && 'provide' in provider;
  }

  private isProviderUseValue(provider: Provider): provider is ProviderUseValue {
    return this.isProviderRecord(provider) && Object.prototype.hasOwnProperty.call(provider, 'useValue');
  }

  private isProviderUseClass(provider: Provider): provider is ProviderUseClass {
    return this.isProviderRecord(provider) && Object.prototype.hasOwnProperty.call(provider, 'useClass');
  }

  private isProviderUseExisting(provider: Provider): provider is ProviderUseExisting {
    return this.isProviderRecord(provider) && Object.prototype.hasOwnProperty.call(provider, 'useExisting');
  }

  private isProviderUseFactory(provider: Provider): provider is ProviderUseFactory {
    return this.isProviderRecord(provider) && Object.prototype.hasOwnProperty.call(provider, 'useFactory');
  }

  private resolveToken(token: Token): Token {
    if (!this.scopedKeys) {
      return token;
    }

    const scoped = this.scopedKeys.get(token);

    if (scoped !== undefined) {
      return scoped;
    }

    return token;
  }
}
