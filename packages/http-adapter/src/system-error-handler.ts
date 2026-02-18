import type { Context } from '@zipbul/common';

import type { SystemError } from './types';

export abstract class SystemErrorHandler {
  public abstract handle(error: SystemError, ctx: Context): void | Promise<void>;
}
