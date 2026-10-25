import type { Err } from './types';
import { ERR } from './constants';

/**
 * Creates an immutable {@link Err} value with no attached data.
 *
 * The returned object is `Object.freeze()`-d. This function **never throws**.
 *
 * @returns A frozen `Err` with `data` typed as `undefined`.
 *
 * @example
 * ```ts
 * const e = err();
 * ```
 */
export function err(): Err;
/**
 * Creates an immutable {@link Err} value carrying the given data.
 *
 * The returned object is `Object.freeze()`-d. This function **never throws**.
 *
 * @param data - Any value describing the error (string, object, number, etc.).
 * @returns A frozen `Err<E>` with `data` set to the provided value.
 *
 * @example
 * ```ts
 * const e = err({ code: 'TIMEOUT', retryAfter: 3000 });
 * console.log(e.data.code); // 'TIMEOUT'
 * ```
 */
export function err<E>(data: E): Err<E>;
export function err<E = undefined>(data?: E): Err<E> {
  return Object.freeze({
    [ERR]: true as const,
    data: data as E,
  });
}
