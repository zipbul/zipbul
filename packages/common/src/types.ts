import type {
  BeforeStart,
  ConfigService,
  Configurer,
  EnvService,
  OnDestroy,
  OnInit,
  OnShutdown,
  OnStart,
} from './interfaces';
import type { Adapter } from './adapter/adapter';

export type ZipbulPrimitive = string | number | boolean | bigint | symbol | null | undefined;

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
  | Adapter
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

/**
 * Factory function signature for `ProviderUseFactory`.
 * Receives resolved dependencies (from `inject` tokens) as arguments
 * and must return a non-void value.
 *
 * @param args - Resolved dependency instances matching the `inject` array
 * @returns The constructed provider value
 * @public
 */
export type ProviderFactoryFn = (...args: readonly ZipbulValue[]) => ZipbulValue;

export interface Class<T = ZipbulValue> {
  new (...args: ReadonlyArray<ZipbulValue>): T;
}

export interface ClassToken<T = unknown> {
  new (...args: never[]): T;
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

export type LazyRefFactory = () => ZipbulValue;

export type DecoratorTarget = Class | Record<string, ValueLike>;

export type ModuleMarker = symbol;

export type ModuleMarkers = ModuleMarker[];

/**
 * AOT 컴파일러가 인식하는 유일한 타입 마커.
 * 런타임에는 `T` 그대로 — 오버헤드 없음.
 * 반환 타입이 `Validated<T>`인 제네릭 메서드 호출을 AOT가 발견하면
 * `T`와 접근 종류를 메타데이터로 추출한다.
 *
 * @public
 */
export type Validated<T> = T;
