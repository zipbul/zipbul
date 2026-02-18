import type { ZipbulValue, Provider } from '@zipbul/common';

import type { ScalarSetupOptions } from './interfaces';

import { ScalarConfigurer } from './scalar-configurer';
import { ScalarConfigurerToken, ScalarSetupOptionsToken } from './tokens';

function provideScalar(options: ScalarSetupOptions): readonly Provider[] {
  return [
    { provide: ScalarSetupOptionsToken, useValue: options },
    {
      provide: ScalarConfigurerToken,
      useFactory: (...args: readonly ZipbulValue[]) => {
        const maybeOptions = args[0];

        if (!isScalarSetupOptions(maybeOptions)) {
          throw new Error('Scalar: invalid ScalarSetupOptions injection.');
        }

        const configurer = new ScalarConfigurer();

        configurer.setOptions(maybeOptions);

        return configurer;
      },
      inject: [ScalarSetupOptionsToken],
    },
  ];
}

function isScalarSetupOptions(value: ZipbulValue | undefined): value is ScalarSetupOptions {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return 'documentTargets' in value && 'httpTargets' in value;
}

export { provideScalar };
