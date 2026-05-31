import { type Err, isErr, type Result } from '@zipbul/result';

import { CookieError } from '../index';

/** Narrow a caught `unknown` to CookieError via a real instanceof check (throws otherwise). */
export function asCookieError(value: unknown): CookieError {
  if (!(value instanceof CookieError)) {
    throw new Error(`expected a CookieError, received: ${String(value)}`);
  }
  return value;
}

/** Narrow a Result to its Err arm via isErr() (throws on Ok). The distinct T param lets E infer. */
export function asErr<T, E>(result: Result<T, E>): Err<E> {
  if (!isErr<E>(result)) {
    throw new Error('expected an Err result, received an Ok');
  }
  return result;
}
