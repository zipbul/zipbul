import type {
  Class,
  ClassToken,
  MiddlewareDefinition,
  PrimitiveArray,
  PrimitiveRecord,
  ProviderToken,
} from '@zipbul/common';
import type { TokenRecord } from '@zipbul/core';

import type { TokenCarrier } from '../interfaces';

import type { RouteHandlerFunction } from './route';

export type ControllerInstance = Record<string, unknown>;

export type ContainerInstance =
  | ControllerInstance
  | RouteHandlerFunction
  | null
  | undefined;

export type ControllerConstructor = Class<ControllerInstance>;

export type MetadataRegistryKey = ClassToken;

export type ParamTypeReference = ProviderToken;

export type DecoratorArgument =
  | ProviderToken
  | TokenRecord
  | TokenCarrier
  | MiddlewareDefinition
  | ErrorConstructor
  | PrimitiveArray
  | PrimitiveRecord
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | undefined;
