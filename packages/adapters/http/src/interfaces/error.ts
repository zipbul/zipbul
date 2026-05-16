import type { HttpStatus } from '../enums';
import type { JsonValue } from '../types';

export interface ErrorResponseData {
  readonly status: HttpStatus;
  readonly message: string;
  readonly errors?: readonly JsonValue[];
}
