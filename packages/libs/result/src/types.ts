import type { ERR } from './constants';

/**
 * The error type returned by {@link err}.
 *
 * Every `Err` carries a `data` payload describing what went wrong. It also
 * carries an internal marker that brands the type, so only `err()` can create
 * an `Err`. The marker is not exported, and `isErr()` is the only way to check it.
 *
 * @template E - The type of the attached error data. Defaults to `undefined`.
 *
 * @example
 * ```ts
 * const e: Err<string> = err('not found');
 * console.log(e.data);  // 'not found'
 * ```
 */
export type Err<E = undefined> = {
  readonly data: E;
  readonly [ERR]: true;
};

/**
 * A plain union representing either a success value (`T`) or an error (`Err<E>`).
 *
 * Unlike wrapper-class approaches, `Result` is just `T | Err<E>` — zero
 * runtime overhead, full type safety. Use {@link isErr} to narrow the type.
 *
 * @template T - The success value type.
 * @template E - The error data type. Defaults to `undefined`.
 *
 * @example
 * ```ts
 * function divide(a: number, b: number): Result<number, string> {
 *   if (b === 0) return err('division by zero');
 *   return a / b;
 * }
 * ```
 */
export type Result<T, E = undefined> = T | Err<E>;

/**
 * A convenient type alias for asynchronous results.
 *
 * This is simply `Promise<Result<T, E>>` — no wrapper class, no extra
 * abstraction. Use it as a return type for async functions that may fail.
 *
 * @template T - The success value type.
 * @template E - The error data type. Defaults to `undefined`.
 *
 * @example
 * ```ts
 * async function fetchUser(id: number): ResultAsync<User, string> {
 *   const res = await fetch(`/api/users/${id}`);
 *   if (!res.ok) return err(res.statusText);
 *   return await res.json();
 * }
 * ```
 */
export type ResultAsync<T, E = undefined> = Promise<Result<T, E>>;
