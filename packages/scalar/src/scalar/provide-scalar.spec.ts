import type { Provider, ProviderToken, ProviderUseFactory, ProviderUseValue } from '@zipbul/common';

import { describe, it, expect } from 'bun:test';

import type { ScalarSetupOptions } from './interfaces';

import { provideScalar } from './provide-scalar';
import { ScalarConfigurer } from './scalar-configurer';
import { ScalarConfigurerToken, ScalarSetupOptionsToken } from './tokens';

describe('provide-scalar', () => {
  it('should return providers for Scalar setup when options are provided', () => {
    // Arrange
    const options: ScalarSetupOptions = {
      documentTargets: 'all',
      httpTargets: ['http-server'],
    };
    // Act
    const providers = provideScalar(options);
    const optionsProvider = getProviderUseValue(providers, ScalarSetupOptionsToken);
    const configurerProvider = getProviderUseFactory(providers, ScalarConfigurerToken);
    const factory = configurerProvider.useFactory;
    const configurer = factory(options);

    // Assert
    expect(providers).toHaveLength(2);
    expect(optionsProvider.useValue).toBe(options);
    expect(configurerProvider.useFactory).toBeDefined();
    expect(configurerProvider.inject).toEqual([ScalarSetupOptionsToken]);
    expect(configurer).toBeInstanceOf(ScalarConfigurer);
  });
});

function getProviderUseValue(providers: readonly Provider[], token: ProviderToken): ProviderUseValue {
  const found = providers.find(provider => isProviderUseValue(provider, token));

  if (!found) {
    throw new Error('Expected Scalar setup options provider to be defined.');
  }

  return found;
}

function getProviderUseFactory(providers: readonly Provider[], token: ProviderToken): ProviderUseFactory {
  const found = providers.find(provider => isProviderUseFactory(provider, token));

  if (!found) {
    throw new Error('Expected Scalar configurer provider to be defined.');
  }

  return found;
}

function isProviderUseValue(provider: Provider, token: ProviderToken): provider is ProviderUseValue {
  return (
    typeof provider === 'object' &&
    provider !== null &&
    'provide' in provider &&
    'useValue' in provider &&
    provider.provide === token
  );
}

function isProviderUseFactory(provider: Provider, token: ProviderToken): provider is ProviderUseFactory {
  return (
    typeof provider === 'object' &&
    provider !== null &&
    'provide' in provider &&
    'useFactory' in provider &&
    provider.provide === token
  );
}
