import type { ZipbulValue, Class, ForwardRef, PrimitiveRecord, Provider, ProviderToken } from '@zipbul/common';

import type { Container } from './container';

export type DependencyProvider = ProviderToken | ForwardRef;

export type Token = ProviderToken;

export interface TokenRecord {
  readonly __zipbul_ref?: string;
  readonly __zipbul_forward_ref?: string;
  readonly name?: string;
}

export type DecoratorArgument =
  | ProviderToken
  | TokenRecord
  | ModuleMetadata
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined;

export type ContainerValue = ZipbulValue;

export type FactoryFn<T = ContainerValue> = (container: Container) => T;

export type ProviderFactory<T = ContainerValue> = (container: Container) => T;

export interface DecoratorMetadata {
  readonly name: string;
  readonly arguments?: readonly DecoratorArgument[];
}

export interface ConstructorParamMetadata {
  readonly type?: ProviderToken | TokenRecord;
  readonly decorators?: readonly DecoratorMetadata[];
}

export interface ClassMetadata {
  readonly decorators?: readonly DecoratorMetadata[];
  readonly constructorParams?: readonly ConstructorParamMetadata[];
}

export interface ControllerWrapperBase<TController extends Class = Class> {
  instance: InstanceType<TController>;
}

export type ControllerWrapper<
  Options extends PrimitiveRecord,
  TController extends Class = Class,
> = ControllerWrapperBase<TController> & Options;

export interface ModuleObject {
  readonly imports?: ReadonlyArray<ModuleImport>;
  readonly controllers?: ReadonlyArray<Class>;
  readonly providers?: ReadonlyArray<Provider>;
  readonly exports?: ReadonlyArray<ProviderToken>;
}

export type ModuleImport = Class | ModuleObject;

export interface ModuleMetadata {
  readonly imports?: ReadonlyArray<ModuleImport>;
  readonly controllers?: ReadonlyArray<Class>;
  readonly providers?: ReadonlyArray<Provider>;
  readonly exports?: ReadonlyArray<ProviderToken>;
}
