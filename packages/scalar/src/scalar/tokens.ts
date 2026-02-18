import type { ZipbulValue } from '@zipbul/common';

import type { ScalarSetupOptions } from './interfaces';
import type { ScalarConfigurer } from './scalar-configurer';

export const ScalarSetupOptionsToken = Symbol.for('@zipbul/scalar:setup-options');
export const ScalarConfigurerToken = Symbol.for('@zipbul/scalar:configurer');

export type ScalarSetupOptionsToken = typeof ScalarSetupOptionsToken;
export type ScalarConfigurerToken = typeof ScalarConfigurerToken;

export interface ScalarSetupOptionsProvider {
  readonly provide: ScalarSetupOptionsToken;
  readonly useValue: ScalarSetupOptions;
}

export interface ScalarConfigurerProvider {
  readonly provide: ScalarConfigurerToken;
  readonly useFactory: (...args: readonly ZipbulValue[]) => ScalarConfigurer;
  readonly inject: readonly [ScalarSetupOptionsToken];
}
