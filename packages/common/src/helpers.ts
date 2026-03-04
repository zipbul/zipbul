import type { ProviderToken, ZipbulContainer, ZipbulValue } from './interfaces';
import type { LazyRefFactory } from './types';

let activeContext: ZipbulContainer | null = null;

/**
 * Sets the active injection context.
 * Called by AOT-generated factory code before class instantiation.
 *
 * @param container - The container to resolve tokens from, or null to clear
 * @public
 */
function setInjectionContext(container: ZipbulContainer | null): void {
  activeContext = container;
}

/**
 * Resolves a provider token from the active injection context.
 * In AOT mode, the injection context is set by the generated factory,
 * and the compiler guarantees type safety — no runtime type check needed.
 *
 * @typeParam T - The expected return type of the resolved provider
 * @param token - The provider token to inject
 * @returns The resolved provider instance typed as `T`
 * @throws When called outside an injection context
 * @example
 * ```ts
 * class PostsService {
 *   private readonly repo = inject<PostsRepository>(PostsRepository);
 * }
 * ```
 * @public
 */
function inject<T = ZipbulValue>(token: ProviderToken): T {
  if (!activeContext) {
    throw new Error(
      '[Zipbul DI] inject() must be called within a DI factory context. ' +
      'Ensure the class is instantiated by the AOT-generated container factory.',
    );
  }

  return activeContext.get(token) as T;
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

export { inject, lazy, setInjectionContext };
