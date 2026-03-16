import type { Err } from '@zipbul/result';
import type { AdapterClass } from './adapter/types';
import type { Context } from './interfaces';

/**
 * Constructor-like type that matches concrete and abstract error classes.
 *
 * @public
 */
export type ExceptionConstructorLike = abstract new (...args: readonly unknown[]) => Error;

/**
 * Handler function for an exception filter definition.
 * Receives the caught exception and the current execution context,
 * and returns an {@link Err} to flow into `[handleResult]`.
 *
 * @param exception - The caught exception instance.
 * @param ctx - The execution context for the current request.
 * @returns An `Err<unknown>` value for protocol-specific response rendering.
 *
 * @public
 */
export type ExceptionFilterHandlerFn<TException = unknown> = (
  exception: TException,
  ctx: Context,
) => Err<unknown> | Promise<Err<unknown>>;

/**
 * Factory function that creates an exception filter handler.
 * Called once during pipeline assembly to produce the handler instance.
 *
 * @public
 */
export type ExceptionFilterFactory<TException = unknown> = () => ExceptionFilterHandlerFn<TException>;

/**
 * Immutable exception filter definition produced by {@link defineExceptionFilter}.
 *
 * @public
 */
export interface ExceptionFilterDefinition {
  readonly factory: ExceptionFilterFactory;
  readonly catchTypes: readonly ExceptionConstructorLike[];
  readonly adapters?: readonly AdapterClass[];
}

/**
 * Declares an exception filter. This is an identity wrapper -- it freezes
 * the definition into an immutable object. Its purpose is to serve
 * as a static marker for the AOT compiler and to provide a
 * type-safe, immutable exception filter reference.
 *
 * @param catchTypes - Error constructor(s) this filter handles. Empty array = catch-all.
 * @param factory - Factory function returning the exception filter handler (universal filter).
 * @returns A frozen {@link ExceptionFilterDefinition}.
 *
 * @example
 * ```ts
 * // Universal exception filter (all adapters)
 * export const notFoundFilter = defineExceptionFilter([NotFoundException], () => {
 *   return (exception, ctx) => err({ status: 404, message: exception.message });
 * });
 *
 * // Adapter-specific exception filter
 * export const httpErrorFilter = defineExceptionFilter([HttpException], [HttpAdapter], () => {
 *   return (exception, ctx) => err({ status: exception.status, message: exception.message });
 * });
 * ```
 *
 * @public
 */
export function defineExceptionFilter<TException extends Error>(
  catchTypes: readonly ExceptionConstructorLike[],
  factory: ExceptionFilterFactory<TException>,
): ExceptionFilterDefinition;
export function defineExceptionFilter<TException extends Error>(
  catchTypes: readonly ExceptionConstructorLike[],
  adapters: readonly AdapterClass[],
  factory: ExceptionFilterFactory<TException>,
): ExceptionFilterDefinition;
export function defineExceptionFilter<TException extends Error>(
  catchTypes: readonly ExceptionConstructorLike[],
  adaptersOrFactory: readonly AdapterClass[] | ExceptionFilterFactory<TException>,
  maybeFactory?: ExceptionFilterFactory<TException>,
): ExceptionFilterDefinition {
  if (typeof adaptersOrFactory === 'function') {
    return Object.freeze({ factory: adaptersOrFactory as ExceptionFilterFactory, catchTypes: Object.freeze([...catchTypes]) });
  }

  if (maybeFactory === undefined) {
    throw new Error('Factory function is required when adapters are specified.');
  }

  return Object.freeze({
    factory: maybeFactory as ExceptionFilterFactory,
    catchTypes: Object.freeze([...catchTypes]),
    adapters: Object.freeze([...adaptersOrFactory]),
  });
}
