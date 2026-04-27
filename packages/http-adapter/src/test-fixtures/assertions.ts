import type { Err, Result } from '@zipbul/result';
import { isErr } from '@zipbul/result';

/**
 * Typed assertion: narrows `Result<T, E>` to `T` at the type level.
 * Throws (failing the test) if the value is an `Err`.
 */
export function unwrapOk<T, E>(result: Result<T, E>): T {
  if (isErr(result)) {
    throw new Error(`expected Ok, got Err: ${JSON.stringify(result.data)}`);
  }
  return result;
}

/**
 * Typed assertion: narrows `Result<T, E>` to `Err<E>` at the type level.
 * Throws (failing the test) if the value is not an `Err`.
 */
export function unwrapErr<T, E>(result: Result<T, E>): Err<E> {
  if (!isErr(result)) {
    throw new Error(`expected Err, got Ok: ${JSON.stringify(result)}`);
  }
  return result;
}

/**
 * Typed HTTP JSON body reader. `Response.json()` is `unknown` by the Fetch
 * spec — test code that knows the server's response shape narrows it here.
 */
export async function readJsonBody<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/**
 * Common shape for HTTP error response bodies emitted by this framework.
 * Use with {@link readJsonBody} when asserting against typical error
 * envelopes produced by `httpError()` / `writeErrorResponse`.
 */
export interface HttpJsonErrorBody {
  readonly status: number;
  readonly message: string;
  readonly errors?: readonly unknown[];
  readonly [key: string]: unknown;
}

/**
 * Narrows a non-null assertion with a descriptive throw. Replaces the
 * anti-pattern of `expect(x).toBeDefined(); x.field` (which does not narrow
 * under strict TS).
 */
export function assertDefined<T>(value: T | undefined | null, label: string): T {
  if (value === undefined || value === null) {
    throw new Error(`${label} is unexpectedly ${value === null ? 'null' : 'undefined'}`);
  }
  return value;
}
