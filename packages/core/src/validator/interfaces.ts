import type { Class } from '@zipbul/common';

import type { ValidationErrors, ValidatorOptionValue, ValidatorValue, ValidatorValueRecord } from './types';

export interface ValidatorOptions {
  message?: string;
  groups?: string[];
  always?: boolean;
  each?: boolean;
  [key: string]: ValidatorOptionValue | undefined;
}

export interface ValidatorFunction {
  (input: ValidatorValueRecord): ValidationErrors;
}

export interface ValidatorHelpers {
  getValidator: (value: ValidatorValue, target: Class | null | undefined) => ValidationErrors;
}

export interface ValidatorClassRefs {
  [key: string]: Class | null | undefined;
}
