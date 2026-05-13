import type { ProviderToken } from '@zipbul/common';
import type { ConstructorParamMetadata } from '@zipbul/core';

import type { DecoratorArgument } from '../types';

export interface TokenCarrier {
  readonly token: ProviderToken;
}

export interface DecoratorMetadata {
  readonly name: string;
  readonly arguments?: readonly DecoratorArgument[];
}

export interface MethodMetadata {
  readonly name: string;
  readonly decorators?: readonly DecoratorMetadata[];
}

export interface ClassMetadata {
  readonly className?: string;
  readonly decorators?: readonly DecoratorMetadata[];
  readonly methods?: readonly MethodMetadata[];
  readonly constructorParams?: readonly ConstructorParamMetadata[];
}
