import type { AdapterCollection, Configurer, Context, PrimitiveArray } from '@zipbul/common';

import type { ScalarSetupOptions } from './interfaces';

import { setupScalar } from './setup';

export class ScalarConfigurer implements Configurer {
  private options: ScalarSetupOptions | undefined;

  public constructor(..._args: PrimitiveArray) {}

  public setOptions(options: ScalarSetupOptions): void {
    this.options = options;
  }

  public configure(_app: Context, adapters: AdapterCollection): void {
    if (this.options === undefined) {
      throw new Error('Scalar: ScalarConfigurer options are required before configure().');
    }

    setupScalar(adapters, this.options);
  }
}
