import type { Class } from '@zipbul/common';

import type {
  ClassRefs,
  InstanceToPlainConverter,
  PlainToInstanceValidator,
  TransformerDecoratorTarget,
  TransformerPlainValue,
  TransformerValue,
} from './types';

export interface PlainToInstanceValidators {
  plainToInstance: PlainToInstanceValidator;
}

export interface InstanceToPlainConverters {
  instanceToPlain: InstanceToPlainConverter;
}

export interface PlainToInstanceCompiler {
  (plain: TransformerPlainValue, Target: Class, classRefs: ClassRefs, validators: PlainToInstanceValidators): TransformerValue;
}

export interface InstanceToPlainCompiler {
  (instance: TransformerValue, converters: InstanceToPlainConverters, classRefs: ClassRefs): TransformerPlainValue;
}

export interface TransformParams {
  value: TransformerValue;
  key: string;
  obj: TransformerDecoratorTarget;
  type: Class;
}

export interface TransformFunction {
  (params: TransformParams): TransformerValue;
}
