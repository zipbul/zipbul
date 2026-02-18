import type { Class } from '@zipbul/common';

import type { MetadataArgument, MetadataDecoratorOptions, MetadataTypeReference, MetadataTypeValue } from './types';

export interface MetadataDecorator {
  readonly name: string;
  readonly arguments?: readonly MetadataArgument[];
  readonly options?: MetadataDecoratorOptions;
}

export interface MetadataPropertyItems {
  readonly typeName?: MetadataTypeReference;
}

export interface MetadataProperty {
  readonly name?: string;
  readonly type?: MetadataTypeValue;
  readonly isArray?: boolean;
  readonly isClass?: boolean;
  readonly isOptional?: boolean;
  readonly items?: MetadataPropertyItems;
  readonly decorators?: readonly MetadataDecorator[];
  readonly metatype?: Class;
}

export interface MetadataParameter {
  readonly name?: string;
  readonly type?: MetadataTypeValue;
  readonly typeArgs?: readonly string[];
  readonly decorators?: readonly MetadataDecorator[];
  readonly index?: number;
}

export interface MetadataMethod {
  readonly name?: string;
  readonly decorators?: readonly MetadataDecorator[];
  readonly parameters?: readonly MetadataParameter[];
}

export interface MetadataConstructorParam {
  readonly name?: string;
  readonly type?: MetadataTypeValue;
  readonly typeArgs?: readonly string[];
  readonly decorators?: readonly MetadataDecorator[];
  readonly index?: number;
}

export interface CombinedMetadataInput {
  readonly className: string;
  readonly properties: readonly MetadataProperty[];
  readonly decorators?: readonly MetadataDecorator[] | undefined;
  readonly constructorParams?: readonly MetadataConstructorParam[] | undefined;
  readonly methods?: readonly MetadataMethod[] | undefined;
}

export interface CombinedMetadata {
  readonly className: string;
  readonly properties: Record<string, MetadataProperty>;
  readonly decorators?: readonly MetadataDecorator[] | undefined;
  readonly constructorParams?: readonly MetadataConstructorParam[] | undefined;
  readonly methods?: readonly MetadataMethod[] | undefined;
}
