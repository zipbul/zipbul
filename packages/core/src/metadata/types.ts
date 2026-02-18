import type { Class, PrimitiveArray, PrimitiveRecord, PrimitiveValue } from '@zipbul/common';

export type MetadataForwardRef = () => Class;

export type MetadataTypeReference =
  | Class
  | MetadataForwardRef
  | string
  | NumberConstructor
  | StringConstructor
  | BooleanConstructor;

export type MetadataTypeValue = MetadataTypeReference | PrimitiveValue;

export type MetadataArgument = PrimitiveValue | PrimitiveArray | PrimitiveRecord;

export type MetadataDecoratorOptions = PrimitiveRecord;
