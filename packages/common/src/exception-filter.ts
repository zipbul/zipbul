import type { Context } from './interfaces';

export abstract class ExceptionFilter<TError = unknown> {
  public abstract catch(error: TError, context: Context): void | Promise<void>;
}
