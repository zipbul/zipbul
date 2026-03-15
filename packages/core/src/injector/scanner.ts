import type {
  Class,
  Provider,
  ProviderToken,
  ProviderUseClass,
  ProviderUseExisting,
  ProviderUseFactory,
  ProviderUseValue,
} from '@zipbul/common';

import type { ZipbulContainer } from '@zipbul/common';
import type { Container } from './container';
import type {
  ClassMetadata,
  ContainerValue,
  ConstructorParamMetadata,
  DecoratorArgument,
  DecoratorMetadata,
  ModuleImport,
  ModuleMetadata,
  ModuleObject,
  ProviderFactory,
} from './types';

import { getRuntimeContext } from '../runtime/runtime-context';
import {
  normalizeToken,
  formatToken,
  isProviderToken,
  resolveTokenRecord,
} from './token-resolver';

export class Scanner {
  constructor(
    private readonly container: Container,
    private readonly registry?: Map<Class, ClassMetadata>,
  ) {}

  public async scan(module: ModuleImport): Promise<void> {
    const visited = new Set<ModuleImport>();

    await this.scanModule(module, visited);
  }

  private async scanModule(moduleOrDynamic: ModuleImport, visited: Set<ModuleImport>): Promise<void> {
    if (moduleOrDynamic === null || moduleOrDynamic === undefined) {
      return;
    }

    if (visited.has(moduleOrDynamic)) {
      return;
    }

    visited.add(moduleOrDynamic);

    if (this.isModuleObject(moduleOrDynamic)) {
      await this.scanModuleObject(moduleOrDynamic, visited);

      return;
    }

    const moduleClass: Class = moduleOrDynamic;

    this.registerProvider(moduleClass);

    const registry = this.registry ?? getRuntimeContext().metadataRegistry;

    if (!registry || !registry.has(moduleClass)) {
      return;
    }

    const meta = registry.get(moduleClass);

    if (!meta) {
      return;
    }

    const moduleDec = meta.decorators?.find((decorator: DecoratorMetadata) => decorator.name === 'Module');

    if (!moduleDec) {
      return;
    }

    const options = this.resolveModuleOptions(moduleDec);
    // 1. Scan Imports (Recursive)
    const imports = options.imports ?? [];

    for (const imported of imports) {
      await this.scanModule(imported, visited);
    }

    // 2. Register Providers
    const providers = options.providers ?? [];

    for (const provider of providers) {
      this.registerProvider(provider);
    }

    // 3. Register Controllers (as providers, so they can be injected/resolved)
    const controllers = options.controllers ?? [];

    for (const controller of controllers) {
      this.registerProvider(controller);
    }
  }

  private registerProvider(provider: Provider): void {
    let token: ProviderToken | undefined;
    let factory: ProviderFactory | undefined;

    if (this.isClassProvider(provider)) {
      token = provider;
      factory = (c: ZipbulContainer) => new provider(...this.resolveDepsFor(provider, c));
    } else if (this.isProviderRecord(provider)) {
      token = provider.provide;

      if (this.isProviderUseValue(provider)) {
        factory = () => provider.useValue;
      } else if (this.isProviderUseFactory(provider)) {
        factory = (c: ZipbulContainer) => {
          const args = Array.isArray(provider.inject) ? provider.inject.map(dep => c.get(dep)) : [];
          const result = provider.useFactory(...args);

          if (result === undefined) {
            return undefined;
          }

          return result;
        };
      } else if (this.isProviderUseClass(provider)) {
        factory = (c: ZipbulContainer) => new provider.useClass(...this.resolveDepsFor(provider.useClass, c));
      } else if (this.isProviderUseExisting(provider)) {
        factory = (c: ZipbulContainer) => c.get(provider.useExisting);
      } else {
        factory = () => null;
      }
    }

    if (token !== undefined && factory !== undefined) {
      this.container.set(token, factory);
    } else {
      console.warn(`[Scanner] Failed to register provider: ${this.formatProvider(provider)}`);
    }
  }

  private resolveDepsFor(ctor: Class, c: ZipbulContainer): ContainerValue[] {
    const runtimeContext = getRuntimeContext();
    const registry = this.registry ?? runtimeContext.metadataRegistry;
    const scopedKeys = runtimeContext.scopedKeys;

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

      const normalizedToken = normalizeToken(token);
      const directScopedKey = isProviderToken(token) ? scopedKeys?.get(token) : undefined;
      const normalizedScopedKey = normalizedToken !== undefined ? scopedKeys?.get(normalizedToken) : undefined;
      const scopedKey = directScopedKey ?? normalizedScopedKey;

      if (scopedKey !== undefined) {
        try {
          return c.get(scopedKey);
        } catch {
          console.warn(
            `[Scanner] Failed to resolve dependency for ${ctor.name}. Token: ${formatToken(token, normalizedToken)}`,
          );

          return undefined;
        }
      }

      const fallbackToken = isProviderToken(token) ? token : undefined;
      const resolvedToken = normalizedToken ?? fallbackToken;

      if (resolvedToken === undefined) {
        console.warn(
          `[Scanner] Failed to resolve dependency for ${ctor.name}. Token: ${formatToken(token, normalizedToken)}`,
        );

        return undefined;
      }

      try {
        return c.get(resolvedToken);
      } catch {
        console.warn(
          `[Scanner] Failed to resolve dependency for ${ctor.name}. Token: ${formatToken(token, normalizedToken)}`,
        );

        return undefined;
      }
    });
  }

  private async scanModuleObject(moduleObj: ModuleObject, visited: Set<ModuleImport>): Promise<void> {
    const providers = moduleObj.providers ?? [];
    const controllers = moduleObj.controllers ?? [];
    const imports = moduleObj.imports ?? [];

    for (const provider of providers) {
      this.registerProvider(provider);
    }

    for (const controller of controllers) {
      this.registerProvider(controller);
    }

    for (const imported of imports) {
      await this.scanModule(imported, visited);
    }
  }

  private isModuleObject(value: ModuleImport): value is ModuleObject {
    return typeof value === 'object' && value !== null;
  }

  private isClassProvider(provider: Provider): provider is Class {
    return typeof provider === 'function';
  }

  private isProviderRecord(
    provider: Provider,
  ): provider is ProviderUseValue | ProviderUseFactory | ProviderUseClass | ProviderUseExisting {
    return typeof provider === 'object' && provider !== null && 'provide' in provider;
  }

  private isProviderUseValue(provider: Provider): provider is ProviderUseValue {
    return this.isProviderRecord(provider) && Object.prototype.hasOwnProperty.call(provider, 'useValue');
  }

  private isProviderUseFactory(provider: Provider): provider is ProviderUseFactory {
    return this.isProviderRecord(provider) && Object.prototype.hasOwnProperty.call(provider, 'useFactory');
  }

  private isProviderUseClass(provider: Provider): provider is ProviderUseClass {
    return this.isProviderRecord(provider) && Object.prototype.hasOwnProperty.call(provider, 'useClass');
  }

  private isProviderUseExisting(provider: Provider): provider is ProviderUseExisting {
    return this.isProviderRecord(provider) && Object.prototype.hasOwnProperty.call(provider, 'useExisting');
  }

  private resolveModuleOptions(decorator: DecoratorMetadata): ModuleMetadata {
    const args = decorator.arguments ?? [];
    const candidate = args[0];

    if (this.isModuleMetadata(candidate)) {
      return candidate;
    }

    return {};
  }

  private isModuleMetadata(value: DecoratorArgument | undefined): value is ModuleMetadata {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    return 'imports' in value || 'controllers' in value || 'providers' in value || 'exports' in value;
  }

  private formatProvider(provider: Provider): string {
    if (typeof provider === 'function') {
      return provider.name.length > 0 ? provider.name : 'AnonymousProvider';
    }

    if (this.isProviderRecord(provider)) {
      return formatToken(provider.provide);
    }

    return 'UnknownProvider';
  }
}
