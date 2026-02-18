import type {
  BeforeStart,
  ZipbulAdapter,
  ConfigService,
  Configurer,
  EnvService,
  OnDestroy,
  OnInit,
  OnShutdown,
  OnStart,
} from './interfaces';

export type ZipbulPrimitive = string | number | boolean | bigint | symbol | null | undefined;

export type ErrorConstructorLike = new (...args: ReadonlyArray<ZipbulValue>) => Error;

export type ErrorToken =
  | ErrorConstructorLike
  | StringConstructor
  | NumberConstructor
  | BooleanConstructor
  | BigIntConstructor
  | SymbolConstructor;

export interface ZipbulArray extends Array<ZipbulValue> {}

export interface ZipbulRecord extends Record<string, ZipbulValue> {}

export interface ZipbulConstructorDescriptor {
  readonly name?: string;
}

export interface ZipbulInstance {
  readonly constructor: ZipbulConstructorDescriptor;
}

export type ZipbulValue =
  | ZipbulPrimitive
  | ZipbulRecord
  | ZipbulArray
  | ZipbulInstance
  | ClassToken
  | Callable
  | ZipbulAdapter
  | ConfigService
  | Configurer
  | EnvService
  | OnInit
  | BeforeStart
  | OnStart
  | OnShutdown
  | OnDestroy;

export interface ZipbulFunction {
  (...args: readonly ZipbulValue[]): ZipbulValue | void;
}

export interface Class<T = ZipbulValue> {
  new (...args: ReadonlyArray<ZipbulValue>): T;
}

export interface ClassToken<T = ZipbulValue> {
  new (...args: ReadonlyArray<ZipbulValue>): T;
}

export type ClassProperties<T> = {
  [K in keyof T]-?: T[K] extends (...args: ZipbulValue[]) => ZipbulValue ? K : never;
}[keyof T];

export type MethodParams<T, K extends ClassProperties<T>> = T[K] extends (...args: infer P) => ZipbulValue | void
  ? [...P]
  : never;

export type MethodReturn<T, K extends ClassProperties<T>> = T[K] extends (...args: ZipbulValue[]) => infer R ? R : never;

export type MethodTailParams<T, K extends ClassProperties<T>> = T[K] extends (
  first: ZipbulValue,
  ...rest: infer R
) => ZipbulValue | void
  ? [...R]
  : [];

export type MethodSecondParam<T, K extends ClassProperties<T>> = T[K] extends (
  a: ZipbulValue,
  b: infer S,
  ...args: ZipbulValue[]
) => ZipbulValue | void
  ? S
  : never;

export type SyncFunction<T extends ZipbulFunction> = ReturnType<T> extends Promise<ZipbulValue> ? never : T;

export type PrimitiveValue = string | number | boolean | bigint | symbol | null | undefined;

export type PrimitiveArray = Array<PrimitiveValue>;

export type PrimitiveRecord = Record<string, PrimitiveValue | PrimitiveArray>;

export interface Callable {
  (...args: ReadonlyArray<ZipbulValue>): ZipbulValue | void;
}

export type Constructor<T = ZipbulValue> = new (...args: ReadonlyArray<ZipbulValue>) => T;

export type ValueLike = PrimitiveValue | PrimitiveArray | PrimitiveRecord | Callable;

export type ForwardRefFactory = () => ZipbulValue;

export type DecoratorTarget = Class | Record<string, ValueLike>;

export type ModuleMarker = symbol;

export type ModuleMarkers = ModuleMarker[];
