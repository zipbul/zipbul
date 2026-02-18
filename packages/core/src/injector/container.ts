import type {
  ZipbulContainer,
  ZipbulFactory,
  Class,
  Provider,
  ProviderToken,
  ProviderUseClass,
  ProviderUseExisting,
  ProviderUseFactory,
  ProviderUseValue,
} from '@zipbul/common';

import type {
  ContainerValue,
  ConstructorParamMetadata,
  DecoratorArgument,
  DecoratorMetadata,
  FactoryFn,
  ModuleObject,
  Token,
  TokenRecord,
} from './types';

import { getRuntimeContext } from '../runtime/runtime-context';

export class Container implements ZipbulContainer {
  private factories = new Map<Token, FactoryFn>();
  private instances = new Map<Token, ContainerValue>();

  constructor(initialFactories?: Map<Token, FactoryFn>) {
    if (initialFactories) {
      this.factories = initialFactories;
    }
  }

  set<TValue extends ContainerValue = ContainerValue>(token: Token, factory: ZipbulFactory<TValue>): void;
  set(token: Token, factory: FactoryFn): void;
  set<TValue extends ContainerValue = ContainerValue>(token: Token, factory: ZipbulFactory<TValue> | FactoryFn): void {
    const wrapped: FactoryFn = c => factory(c);

    this.factories.set(token, wrapped);
  }

  get(token: Token): ContainerValue {
    const existing = this.instances.get(token);

    if (this.instances.has(token)) {
      return existing;
    }

    const factory = this.factories.get(token);

    if (!factory) {
      const tokenLabel = this.formatToken(token);

      throw new Error(`No provider for token: ${tokenLabel}`);
    }

    const instance = factory(this);

    this.instances.set(token, instance);

    return instance;
  }

  keys(): IterableIterator<Token> {
    return this.factories.keys();
  }

  has(token: Token): boolean {
    return this.factories.has(token);
  }

  getInstances(): IterableIterator<ContainerValue> {
    return this.instances.values();
  }

  async loadDynamicModule(scope: string, dynamicModule: ModuleObject | null | undefined): Promise<void> {
    if (dynamicModule === null || dynamicModule === undefined) {
      return;
    }

    await Promise.resolve();

    const providers = dynamicModule.providers ?? [];

    for (const provider of providers) {
      let token: Token | undefined;
      let factory: FactoryFn | undefined;

      if (this.isClassProvider(provider)) {
        token = provider;
        factory = c => new provider(...this.resolveDepsFor(provider, scope, c));
      } else if (this.isProviderRecord(provider)) {
        token = provider.provide;

        if (this.isProviderUseValue(provider)) {
          factory = () => provider.useValue;
        } else if (this.isProviderUseClass(provider)) {
          factory = c => new provider.useClass(...this.resolveDepsFor(provider.useClass, scope, c));
        } else if (this.isProviderUseExisting(provider)) {
          factory = c => {
            const existingKey = this.normalizeToken(provider.useExisting);
            const hasExistingKey = typeof existingKey === 'string' && existingKey.length > 0;
            const scopedKey = hasExistingKey ? `${scope}::${existingKey}` : '';

            if (scopedKey.length > 0 && c.has(scopedKey)) {
              return c.get(scopedKey);
            }

            if (hasExistingKey) {
              return c.get(existingKey);
            }

            throw new Error(`No existing provider found for alias token: ${this.formatToken(provider.useExisting)}`);
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

      const normalizedToken = this.normalizeToken(token);
      const keyStr = normalizedToken !== undefined ? `${scope}::${normalizedToken}` : '';

      if (keyStr.length > 0 && factory !== undefined) {
        this.set(keyStr, factory);
      }
    }
  }

  private resolveDepsFor(ctor: Class, scope: string, _c: Container): ContainerValue[] {
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

      token = this.resolveTokenRecord(token);

      const injectDec = param.decorators?.find((decorator: DecoratorMetadata) => decorator.name === 'Inject');
      const injectArgs = injectDec?.arguments ?? [];

      if (injectArgs.length > 0) {
        const injectedToken = this.coerceToken(injectArgs[0]);

        if (injectedToken !== undefined) {
          token = this.resolveTokenRecord(injectedToken);
        }
      }

      const tokenName = this.normalizeToken(token);
      const key = tokenName !== undefined ? `${scope}::${tokenName}` : '';

      if (key.length > 0 && this.has(key)) {
        return this.get(key);
      }

      if (tokenName === undefined) {
        return undefined;
      }

      try {
        return this.get(tokenName);
      } catch (_e2) {
        return undefined;
      }
    });
  }

  private normalizeToken(token: Token | TokenRecord | undefined): string | undefined {
    if (token === null || token === undefined) {
      return undefined;
    }

    if (typeof token === 'string') {
      return token;
    }

    if (typeof token === 'symbol') {
      return token.description ?? token.toString();
    }

    if (typeof token === 'function') {
      const tokenName = token.name;

      if (tokenName.length > 0) {
        return tokenName;
      }
    }

    if (this.isTokenRecord(token)) {
      const ref = token.__zipbul_ref;
      const forwardRef = token.__zipbul_forward_ref;

      if (typeof ref === 'string') {
        return ref;
      }

      if (typeof forwardRef === 'string') {
        return forwardRef;
      }

      const tokenName = token.name;

      if (typeof tokenName === 'string' && tokenName.length > 0) {
        return tokenName;
      }
    }

    return undefined;
  }

  private formatToken(token: Token | TokenRecord | undefined, normalized?: string): string {
    if (typeof normalized === 'string' && normalized.length > 0) {
      return normalized;
    }

    if (typeof token === 'string') {
      return token;
    }

    if (typeof token === 'symbol') {
      return token.description ?? token.toString();
    }

    if (typeof token === 'function') {
      return token.name.length > 0 ? token.name : 'AnonymousToken';
    }

    if (this.isTokenRecord(token)) {
      const tokenName = token.name;

      return typeof tokenName === 'string' && tokenName.length > 0 ? tokenName : 'TokenRecord';
    }

    return 'UnknownToken';
  }

  private coerceToken(value: DecoratorArgument | undefined): Token | TokenRecord | undefined {
    if (this.isProviderToken(value) || this.isTokenRecord(value)) {
      return value;
    }

    return undefined;
  }

  private isProviderToken(value: DecoratorArgument | Token | TokenRecord | undefined): value is Token {
    return typeof value === 'string' || typeof value === 'symbol' || typeof value === 'function';
  }

  private isTokenRecord(value: DecoratorArgument | Token | TokenRecord | undefined): value is TokenRecord {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    if ('__zipbul_ref' in value && typeof value.__zipbul_ref === 'string') {
      return true;
    }

    if ('__zipbul_forward_ref' in value && typeof value.__zipbul_forward_ref === 'string') {
      return true;
    }

    if ('name' in value && typeof value.name === 'string') {
      return true;
    }

    return false;
  }

  private resolveTokenRecord(token: Token | TokenRecord | undefined): Token | TokenRecord | undefined {
    if (!this.isTokenRecord(token)) {
      return token;
    }

    if (typeof token.__zipbul_ref === 'string') {
      return token.__zipbul_ref;
    }

    if (typeof token.__zipbul_forward_ref === 'string') {
      return token.__zipbul_forward_ref;
    }

    return token;
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
}
