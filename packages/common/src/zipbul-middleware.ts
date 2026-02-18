import type { Context, MiddlewareRegistration } from './interfaces';
import type { Class } from './types';

export abstract class ZipbulMiddleware<TOptions = void> {
  public static withOptions<TOptions>(
    this: Class<ZipbulMiddleware<TOptions>>,
    options: TOptions,
  ): MiddlewareRegistration<TOptions> {
    return {
      token: this,
      options,
    };
  }

  public abstract handle(context: Context, options?: TOptions): void | boolean | Promise<void | boolean>;
}
