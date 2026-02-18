import type { PrimitiveArray } from '@zipbul/common';

import type { ValidatorOptions } from './interfaces';
import type { ValidatorDecoratorArgs, ValidatorDecoratorTarget, ValidatorPropertyDecorator } from './types';

function createDecorator(
  decoratorName: string,
  decoratorArgs: ValidatorDecoratorArgs = [],
  decoratorOptions?: ValidatorOptions,
): ValidatorPropertyDecorator {
  void decoratorName;
  void decoratorArgs;

  const options = decoratorOptions ?? {};

  void options;

  return function (target: ValidatorDecoratorTarget, propertyKey: string | symbol) {
    void target;
    void propertyKey;
  };
}

function IsString(options?: ValidatorOptions) {
  return createDecorator('IsString', [], options);
}

function IsNumber(options?: ValidatorOptions) {
  return createDecorator('IsNumber', [], options);
}

function IsInt(options?: ValidatorOptions) {
  return createDecorator('IsInt', [], options);
}

function IsBoolean(options?: ValidatorOptions) {
  return createDecorator('IsBoolean', [], options);
}

function IsArray(options?: ValidatorOptions) {
  return createDecorator('IsArray', [], options);
}

function IsOptional(options?: ValidatorOptions) {
  return createDecorator('IsOptional', [], options);
}

function IsIn(values: PrimitiveArray, options?: ValidatorOptions) {
  return createDecorator('IsIn', [values], options);
}

function Min(min: number, options?: ValidatorOptions) {
  return createDecorator('Min', [min], options);
}

function Max(max: number, options?: ValidatorOptions) {
  return createDecorator('Max', [max], options);
}

function ValidateNested(options?: ValidatorOptions) {
  return createDecorator('ValidateNested', [], options);
}

export {
  IsString,
  IsNumber,
  IsInt,
  IsBoolean,
  IsArray,
  IsOptional,
  IsIn,
  Min,
  Max,
  ValidateNested,
};