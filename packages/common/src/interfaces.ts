import type { ZipbulFunction, ZipbulValue, Class, ClassToken, ValueLike } from './types';
import type { AdapterClass } from './adapter/types';
import type { MiddlewareDefinition } from './define-middleware';

import type { Adapter } from './adapter/adapter';

export interface Context {
  getType(): string;
  get(key: string): ZipbulValue | undefined;
  to<TContext extends ZipbulValue>(ctor: ClassToken<TContext>): TContext;
}

/**
 * Parameter decorator marking a constructor parameter for context injection.
 * This is a no-op at runtime — actual resolution happens at AOT build time.
 *
 * @public
 */
export function Context(): ParameterDecorator {
  return () => {};
}

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
  useFactory: ZipbulFunction;
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
  configure(app: Context, adapters: AdapterCollection): void;
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

export type ProviderVisibleTo = 'all' | 'module' | string[];

export interface ZipbulContainer {
  get(token: ProviderToken): ZipbulValue;
  set<TValue extends ZipbulValue = ZipbulValue>(token: ProviderToken, factory: ZipbulFactory<TValue>, options?: ProviderRegistrationOptions): void;
  has(token: ProviderToken): boolean;
  getInstances(): IterableIterator<ZipbulValue>;
  keys(): IterableIterator<ProviderToken>;
}

export type ExceptionFilterToken = ProviderToken;

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
  errorFilters?: ExceptionFilterConfig[];
}

export interface MiddlewareConfig {
  [lifecycle: string]: readonly MiddlewareDefinition[];
}

export type ExceptionFilterConfig = ExceptionFilterToken;

export type Provider = ProviderUseValue | ProviderUseClass | ProviderUseExisting | ProviderUseFactory | Class;
