import type { Err } from '@zipbul/result';
import type { Context } from './interfaces';

/**
 * Base class for exception filters.
 * Subclasses must return `Err<unknown>` which flows into `[handleResult]`
 * for protocol-specific response rendering.
 *
 * @typeParam TError - The expected error type this filter handles
 * @public
 */
export abstract class ExceptionFilter<TError = unknown> {
  public abstract catch(error: TError, context: Context): Err<unknown> | Promise<Err<unknown>>;
}
