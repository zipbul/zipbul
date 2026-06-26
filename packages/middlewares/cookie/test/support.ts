import { type Err, isErr, type Result } from '@zipbul/result';

import { CookieError } from '../src/interfaces';

/** Narrow a caught `unknown` to CookieError via a real instanceof check (throws otherwise). */
export function asCookieError(value: unknown): CookieError {
  if (!(value instanceof CookieError)) {
    throw new Error(`expected a CookieError, received: ${String(value)}`);
  }
  return value;
}

/** Run a thunk expected to throw a CookieError (boot/config error); return it. Throws if it doesn't. */
export function captureCookieError(fn: () => unknown): CookieError {
  try {
    fn();
  } catch (e) {
    return asCookieError(e);
  }
  throw new Error('expected the call to throw a CookieError, but it returned normally');
}

/** Narrow a Result to its Err arm via isErr() (throws on Ok). The distinct T param lets E infer. */
export function asErr<T, E>(result: Result<T, E>): Err<E> {
  if (!isErr<E>(result)) {
    throw new Error('expected an Err result, received an Ok');
  }
  return result;
}

/** Unwrap a Result to its Ok value (throws if it is an Err). Use where a test expects success. */
export function expectOk<T, E>(result: Result<T, E>): T {
  if (isErr<E>(result)) {
    throw new Error(`expected an Ok result, received an Err: ${JSON.stringify(result.data)}`);
  }
  return result;
}
