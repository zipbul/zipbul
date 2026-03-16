import { AsyncLocalStorage } from 'node:async_hooks';

import type { ProviderToken, ZipbulContainer } from './interfaces';
import type { ClassToken, ZipbulValue } from './types';
import type { LazyRefFactory } from './types';

const injectionStore = new AsyncLocalStorage<ZipbulContainer>();

/**
 * Runs a function within a DI injection context.
 * All `inject()` calls inside `fn` will resolve from the given container.
 * Uses `AsyncLocalStorage` — safe for concurrent async requests.
 *
 * @param container - The container to resolve tokens from
 * @param fn - The function to execute within the injection context
 * @returns The return value of `fn`
 * @example
 * ```ts
 * runInInjectionContext(container, () => {
 *   const service = inject(MyService);
 * });
 * ```
 * @public
 */
function runInInjectionContext<T>(container: ZipbulContainer, fn: () => T): T {
  return injectionStore.run(container, fn);
}

/**
 * Resolves a provider token from the active injection context.
 * In AOT mode, the injection context is set by `runInInjectionContext`,
 * and the compiler guarantees type safety at build time.
 *
 * When called with a class token, the return type is inferred from the class.
 * When called with a string or symbol token, the return type is `ZipbulValue`.
 *
 * @param token - The provider token to inject
 * @returns The resolved provider instance, typed as `T` for class tokens
 * @throws When called outside an injection context
 * @example
 * ```ts
 * class PostsService {
 *   private readonly repo = inject(PostsRepository); // typed as PostsRepository
 * }
 * ```
 * @public
 */
function inject<T>(token: ClassToken<T>): T;
function inject(token: ProviderToken): ZipbulValue;
function inject(token: ProviderToken): ZipbulValue {
  const container = injectionStore.getStore();

  if (!container) {
    throw new Error('[Zipbul DI] inject() must be called within a DI context.');
  }

  return container.get(token);
}

/**
 * Declares a lazy (circular) dependency. AOT-only — runtime calls throw.
 * Use this to explicitly opt-in to circular dependency resolution.
 *
 * @param _fn - Factory function returning the provider token
 * @returns Never — transformed at build time
 * @example
 * ```ts
 * class A {
 *   private readonly b = inject(lazy(() => B));
 * }
 * ```
 * @public
 */
function lazy(_fn: LazyRefFactory): never {
  throw new Error('[Zipbul DI] lazy() is AOT-only and must not run at runtime.');
}

export { inject, lazy, runInInjectionContext };
