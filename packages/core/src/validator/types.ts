import type { ZipbulValue, Class, PrimitiveArray, PrimitiveRecord, PrimitiveValue } from '@zipbul/common';

export type ValidatorTarget = Class;

export type ValidatorValueItem = PrimitiveValue | PrimitiveArray | PrimitiveRecord;

export type ValidatorValueArray = Array<ValidatorValueItem>;

export type ValidatorValueRecord = Record<string, ValidatorValueItem | ValidatorValueArray>;

export type ValidatorValue = ValidatorValueItem | ValidatorValueArray | ValidatorValueRecord;

export type ValidationErrors = string[];

export type ValidatorOptionValue = PrimitiveValue | PrimitiveArray | PrimitiveRecord;

export type ValidatorDecoratorArgument = ValidatorOptionValue;

export type ValidatorDecoratorArgs = ReadonlyArray<ValidatorDecoratorArgument>;

export type ValidatorDecoratorTarget = ZipbulValue;

export type ValidatorPropertyDecorator = PropertyDecorator;
