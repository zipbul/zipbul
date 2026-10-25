import type { Result, ResultAsync } from './types';
import { err } from './err';

/**
 * Executes a synchronous function and catches any thrown value into an {@link Err}.
 *
 * If `fn` returns normally, its return value is passed through as the success
 * value. If `fn` throws, the thrown value is wrapped with `err()` and returned.
 *
 * @param fn - A synchronous function to execute safely.
 * @returns The function's return value on success, or `Err<unknown>` on throw.
 *
 * @example
 * ```ts
 * const result = safe(() => JSON.parse(raw));
 * if (isErr(result)) console.error(result.data);
 * ```
 */
export function safe<T>(fn: () => T): Result<T, unknown>;
/**
 * Executes a synchronous function and maps any thrown value through `mapErr`
 * before wrapping it in an {@link Err}.
 *
 * This overload lets you convert the raw `unknown` throw into a well-typed
 * error value, keeping your error types precise.
 *
 * @param fn - A synchronous function to execute safely.
 * @param mapErr - Transforms the thrown value into a typed error `E`.
 * @returns The function's return value on success, or `Err<E>` on throw.
 *
 * @example
 * ```ts
 * const result = safe(
 *   () => JSON.parse(raw),
 *   (e) => ({ code: 'PARSE', message: String(e) }),
 * );
 * ```
 */
export function safe<T, E>(fn: () => T, mapErr: (thrown: unknown) => E): Result<T, E>;
/**
 * Wraps a Promise so that rejections become {@link Err} values instead of
 * thrown exceptions.
 *
 * If the promise resolves, the resolved value is passed through. If it
 * rejects, the rejection reason is wrapped with `err()` and the returned
 * promise resolves (never rejects) to `Err<unknown>`.
 *
 * @param promise - The promise to wrap.
 * @returns A `ResultAsync` that always resolves — either to `T` or to `Err<unknown>`.
 *
 * @example
 * ```ts
 * const result = await safe(fetch('/api/data'));
 * ```
 */
export function safe<T>(promise: Promise<T>): ResultAsync<T, unknown>;
/**
 * Wraps a Promise so that rejections are mapped through `mapErr` and returned
 * as typed {@link Err} values.
 *
 * Combines the safety of promise wrapping with precise error typing.
 *
 * @param promise - The promise to wrap.
 * @param mapErr - Transforms the rejection reason into a typed error `E`.
 * @returns A `ResultAsync` that resolves to `T` or `Err<E>`. It rejects only if `mapErr` throws.
 *
 * @example
 * ```ts
 * const result = await safe(
 *   fetch('/api/users/1'),
 *   (e) => ({ code: 'NETWORK', message: String(e) }),
 * );
 * ```
 */
export function safe<T, E>(promise: Promise<T>, mapErr: (thrown: unknown) => E): ResultAsync<T, E>;
export function safe<T, E = unknown>(
  input: (() => T) | Promise<T>,
  mapErr?: (thrown: unknown) => E,
): Result<T, E> | ResultAsync<T, E> {
  const toErr = (thrown: unknown) => err(mapErr ? mapErr(thrown) : (thrown as E));

  if (typeof input === 'function') {
    try {
      return input();
    } catch (thrown) {
      return toErr(thrown);
    }
  }

  // A fresh native promise adopts `input`, so a hostile or foreign-realm
  // promise can only reject it, never throw synchronously.
  return new Promise<T>((resolve) => resolve(input)).then((value) => value, toErr);
}
