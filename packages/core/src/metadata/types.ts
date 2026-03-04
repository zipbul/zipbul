import type { Class, PrimitiveArray, PrimitiveRecord, PrimitiveValue } from '@zipbul/common';

export type MetadataLazyRef = () => Class;

export type MetadataTypeReference =
  | Class
  | MetadataLazyRef
  | string
  | NumberConstructor
  | StringConstructor
  | BooleanConstructor;

export type MetadataTypeValue = MetadataTypeReference | PrimitiveValue;

export type MetadataArgument = PrimitiveValue | PrimitiveArray | PrimitiveRecord;

export type MetadataDecoratorOptions = PrimitiveRecord;
