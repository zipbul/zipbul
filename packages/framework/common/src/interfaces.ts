import type { ZipbulValue, Class, ClassToken, ValueLike, ModuleMarker, ProviderFactoryFn } from './types';
import type { AdapterClass } from './adapter/types';
import type { MiddlewareDefinition } from './define-middleware';
import type { GuardDefinition } from './define-guard';
import type { ExceptionFilterDefinition } from './define-exception-filter';
import type { ContextKey } from './context-key';

import type { Adapter } from './adapter/types';

/**
 * Application-level context for lifecycle management.
 *
 * Used during application bootstrap (Configurer, adapter.start).
 * Does NOT support per-request features (get/set, validation).
 *
 * @public
 */
export interface ApplicationContext {
  readonly container: ZipbulContainer;
}

/**
 * Base context for all adapter request processing.
 *
 * Each protocol adapter implements this interface with protocol-specific
 * extensions (e.g. HttpContext adds request/response).
 * Used by middleware, guards, exception filters, and handlers.
 *
 * @public
 */
export interface AdapterContext {
  getType(): string;

  /**
   * Returns a per-request value stored under the given typed key.
   *
   * @param key - A `ContextKey<T>` created via `contextKey()`.
   * @returns The stored value, or `undefined` if not set.
   * @public
   */
  get<T>(key: ContextKey<T>): T | undefined;

  /**
   * Stores a per-request value under the given typed key.
   *
   * @param key - A `ContextKey<T>` created via `contextKey()`.
   * @param value - The value to store.
   * @public
   */
  set<T>(key: ContextKey<T>, value: T): void;

  /**
   * Returns a per-request value, throwing if not set.
   * The AOT compiler verifies at build time that a provider (adapter step or middleware)
   * exists for the given key. Use `get()` for optional access.
   *
   * @param key - A `ContextKey<T>` created via `contextKey()`.
   * @returns The stored value.
   * @throws `ContextError` if the key has not been set.
   * @public
   */
  use<T>(key: ContextKey<T>): T;

  to<TContext extends ZipbulValue>(ctor: ClassToken<TContext>): TContext;
}

/**
 * Alias for {@link AdapterContext}.
 *
 * Handlers conventionally annotate their context parameter as `ctx: Context`.
 * The alias keeps that idiom readable while the underlying interface remains
 * `AdapterContext`.
 *
 * @public
 */
export type Context = AdapterContext;

// DI Interfaces
export type ProviderToken = string | symbol | ClassToken | Class;

export type ProviderScope = 'singleton' | 'request' | 'transient';

export interface ProviderBase {
  provide: ProviderToken;
}

export interface ProviderUseValue extends ProviderBase {
  useValue: ZipbulValue | EnvService | ConfigService;
}

export interface ProviderUseClass extends ProviderBase {
  useClass: Class;
}

export interface ProviderUseExisting extends ProviderBase {
  useExisting: ProviderToken;
}

export interface ProviderUseFactory extends ProviderBase {
  useFactory: ProviderFactoryFn;
  inject?: ProviderToken[];
}

// Lifecycle Interfaces
export interface OnInit {
  onInit(): Promise<void> | void;
}

export interface BeforeStart {
  beforeStart(): Promise<void> | void;
}

export interface OnStart {
  onStart(): Promise<void> | void;
}

export interface OnShutdown {
  onShutdown(signal?: string): Promise<void> | void;
}

export interface OnDestroy {
  onDestroy(): Promise<void> | void;
}

export interface AdapterGroup<T> {
  get(name: string): T | undefined;
  all(): T[];
  forEach(cb: (adapter: T) => void): void;
}

export interface AdapterCollection {
  [protocol: string]: AdapterGroup<Adapter>;
}

export interface Configurer {
  configure(app: ApplicationContext, adapters: AdapterCollection): void;
}

export interface ApplicationOptions {
  //
}

export interface ConfigService {
  get(namespace: string | symbol): ValueLike;
}

export interface EnvService {
  get(key: string, fallback?: string): string;
  getOptional(key: string): string | undefined;
  getInt(key: string, fallback: number): number;
  snapshot(): Readonly<Record<string, string>>;
}

export interface EnvSource {
  readonly name?: string;
  load(): Promise<Readonly<Record<string, string>>> | Readonly<Record<string, string>>;
}

export type ZipbulFactory<TValue = ZipbulValue> = (container: ZipbulContainer) => TValue;

export interface ProviderRegistrationOptions {
  readonly scope?: ProviderScope;
  readonly visibleTo?: ProviderVisibleTo;
}

export type ProviderVisibleTo = 'all' | 'module' | readonly ModuleMarker[];

export interface ZipbulContainer {
  get(token: ProviderToken): ZipbulValue;
  set<TValue extends ZipbulValue = ZipbulValue>(token: ProviderToken, factory: ZipbulFactory<TValue>, options?: ProviderRegistrationOptions): void;
  has(token: ProviderToken): boolean;
  getInstances(): IterableIterator<ZipbulValue>;
  keys(): IterableIterator<ProviderToken>;

  /**
   * Creates a request-scoped child container.
   * Singletons delegate to the parent; request-scoped providers are cached per contextId.
   *
   * @param contextId - Unique identifier for this request scope.
   * @param requestOverrides - Optional per-token override registry consulted
   *   by the child container before the parent registration. Used by
   *   `@zipbul/testing` to swap request-scoped providers per test.
   * @returns A scoped container that implements `ZipbulContainer`.
   */
  createRequestScope?(
    contextId: string,
    requestOverrides?: ReadonlyMap<unknown, unknown>,
  ): ZipbulContainer;

  /**
   * Returns whether any provider is registered with request scope.
   * Used by adapters to skip unnecessary request-scope container creation.
   */
  hasRequestScope?(): boolean;

  /**
   * Disposes scoped resources. No-op on the root container.
   * Request-scoped containers clear cached instances and call onDestroy hooks.
   */
  dispose?(): Promise<void>;
}

// Module Interface (Strict Schema Enforcement)
export interface Module {
  name?: string;
  providers?: Provider[];
  adapters?: AdapterModuleConfig[];
}

/**
 * Per-adapter configuration within a module.
 *
 * @public
 */
export interface AdapterModuleConfig {
  adapter: AdapterClass;
  name?: string;
  middlewares?: MiddlewareConfig;
  exceptionFilters?: readonly ExceptionFilterDefinition[];
  guards?: readonly GuardDefinition[];
}

/** Phase-keyed middleware configuration. Keys are adapter-specific phase identifiers (e.g. `HttpPhase.OnRequest`). */
export type MiddlewareConfig = Readonly<Record<string, readonly MiddlewareDefinition[]>>;

export type Provider = ProviderUseValue | ProviderUseClass | ProviderUseExisting | ProviderUseFactory | Class;
