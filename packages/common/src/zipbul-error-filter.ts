import type { Context } from './interfaces';
import type { ZipbulValue } from './types';

export abstract class ZipbulErrorFilter<TError = ZipbulValue> {
  public abstract catch(error: TError, context: Context): void | Promise<void>;
}
