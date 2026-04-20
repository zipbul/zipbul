import type { Err, Result } from '@zipbul/result';
import { isErr } from '@zipbul/result';

/**
 * Typed assertion: narrows `Result<T, E>` to `T`. Throws (failing the test)
 * if the value is an `Err`. Replaces the spec anti-pattern of accessing
 * properties off a `Result` without narrowing — noUncheckedIndexedAccess +
 * strict typing would otherwise reject every unwrapped access.
 */
export function unwrapOk<T, E>(result: Result<T, E>): T {
  if (isErr(result)) {
    throw new Error(`expected Ok, got Err: ${JSON.stringify(result.data)}`);
  }
  return result;
}

/**
 * Typed assertion: narrows `Result<T, E>` to `Err<E>`.
 */
export function unwrapErr<T, E>(result: Result<T, E>): Err<E> {
  if (!isErr(result)) {
    throw new Error(`expected Err, got Ok: ${JSON.stringify(result)}`);
  }
  return result;
}

/**
 * Narrows a possibly-undefined value. Replaces `expect(x).toBeDefined(); x.y`
 * (which does not narrow under strict TS).
 */
export function assertDefined<T>(value: T | undefined | null, label: string): T {
  if (value === undefined || value === null) {
    throw new Error(`${label} is unexpectedly ${value === null ? 'null' : 'undefined'}`);
  }
  return value;
}
