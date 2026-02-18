import type { ZipbulMiddleware } from './zipbul-middleware';
import type { ZipbulFunction, ZipbulValue, Class, ClassToken, ValueLike } from './types';

export interface ZipbulAdapter {
  start(context: Context): Promise<void>;
  stop(): Promise<void>;
}

export interface Context {
  getType(): string;
  get(key: string): ZipbulValue | undefined;
  to<TContext extends ZipbulValue>(ctor: ClassToken<TContext>): TContext;
}

// DI Interfaces
export type ProviderToken = string | symbol | ClassToken | Class;

export type ProviderScope = 'singleton' | 'request-context' | 'transient';

export type ProviderVisibility = 'internal' | 'exported';

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

export interface ForwardRef {
  forwardRef: () => ZipbulValue;
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
  [protocol: string]: AdapterGroup<ZipbulAdapter>;
}

export interface Configurer {
  configure(app: Context, adapters: AdapterCollection): void;
}

export interface ZipbulApplicationOptions {
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

export type MiddlewareToken<TOptions = ZipbulValue> = Class<ZipbulMiddleware<TOptions>> | symbol;

export interface MiddlewareRegistration<TOptions = ZipbulValue> {
  token: MiddlewareToken<TOptions>;
  options?: TOptions;
}

export type ZipbulFactory<TValue = ZipbulValue> = (container: ZipbulContainer) => TValue;

export interface ZipbulContainer {
  get(token: ProviderToken): ZipbulValue;
  set<TValue = ZipbulValue>(token: ProviderToken, factory: ZipbulFactory<TValue>): void;
  has(token: ProviderToken): boolean;
  getInstances(): IterableIterator<ZipbulValue>;
  keys(): IterableIterator<ProviderToken>;
}

export type ErrorFilterToken = ProviderToken;

// Module Interface (Strict Schema Enforcement)
export interface ZipbulModule {
  name?: string;
  providers?: Provider[];
  adapters?: AdapterConfig;
}

export interface AdapterConfig {
  [protocol: string]: AdapterProtocolConfig;
}

export interface AdapterProtocolConfig {
  [instanceName: string]: AdapterInstanceConfig;
}

export interface AdapterInstanceConfig {
  middlewares?: MiddlewareConfig;
  errorFilters?: ErrorFilterConfig[];
  [key: string]: ZipbulValue | MiddlewareConfig | ErrorFilterConfig[];
}

export interface MiddlewareConfig {
  [lifecycle: string]: Array<MiddlewareToken | MiddlewareRegistration>;
}

export type ErrorFilterConfig = ErrorFilterToken;

export type Provider = ProviderUseValue | ProviderUseClass | ProviderUseExisting | ProviderUseFactory | Class;
