import type { ZipbulRecord, Class, PrimitiveArray, PrimitiveRecord, PrimitiveValue } from '@zipbul/common';

export type TransformerValueItem = PrimitiveValue | PrimitiveRecord | ZipbulRecord;

export type TransformerValueArray = Array<TransformerValue>;

export interface TransformerValueRecord {
  [key: string]: TransformerValue;
}

export type TransformerValue = TransformerValueItem | TransformerValueArray | TransformerValueRecord;

export type TransformerPlainValue = PrimitiveValue | PrimitiveArray | PrimitiveRecord;

export type TransformerPlainRecord = PrimitiveRecord;

export type TransformerDecoratorTarget = Record<string, TransformerValue>;

export type ClassRefs = Record<string, Class<TransformerValue> | null | undefined>;

export type PlainToInstanceFn = (plain: TransformerPlainValue) => TransformerValue;

export type InstanceToPlainFn = (instance: TransformerValue) => TransformerValueRecord;

export type PlainToInstanceValidator = (target: Class | null | undefined, value: TransformerPlainValue) => TransformerValue;

export type InstanceToPlainConverter = (value: TransformerValue, target?: Class | null) => TransformerPlainValue;
