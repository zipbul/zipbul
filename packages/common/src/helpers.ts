import type { ProviderToken } from './interfaces';

function inject(_token: ProviderToken): never {
  throw new Error('[Zipbul DI] inject() is AOT-only and must not run at runtime.');
}

export { inject };