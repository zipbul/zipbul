import type { Err } from './types';
import { ERR } from './constants';

/**
 * Type guard that checks whether a value is an {@link Err}.
 *
 * Returns `true` when `value` is an object carrying the `Err` marker. This
 * function **never throws** — it safely handles `null`, `undefined`,
 * primitives, and even hostile Proxy objects.
 *
 * No type argument is needed: the error type is narrowed from the `Result`
 * passed in. An `unknown` input narrows to `Err<unknown>`.
 *
 * @param value - The value to check. Can be anything.
 * @returns `true` if `value` is an `Err`, allowing TypeScript to narrow the type.
 *
 * @example
 * ```ts
 * const result: Result<number, string> = doSomething();
 *
 * if (isErr(result)) {
 *   console.error(result.data); // string
 * } else {
 *   console.log(result + 1);    // number
 * }
 * ```
 */
export function isErr(value: unknown): value is Err<unknown> {
  try {
    return (
      typeof value === 'object' &&
      value !== null &&
      (value as Record<PropertyKey, unknown>)[ERR] === true
    );
  } catch {
    return false;
  }
}
