import { type Err, isErr, type Result } from '@zipbul/result';

import { CookieError } from '../index';

export function asCookieError(value: unknown): CookieError {
  if (!(value instanceof CookieError)) {
    throw new Error(`expected a CookieError, received: ${String(value)}`);
  }
  return value;
}

export function asErr<E>(result: Result<unknown, E>): Err<E> {
  if (!isErr<E>(result)) {
    throw new Error('expected an Err result, received an Ok');
  }
  return result;
}
