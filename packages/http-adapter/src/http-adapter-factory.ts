import type { ZipbulValue, ConfigService } from '@zipbul/common';
import type { BootstrapAdapter } from '@zipbul/core';

import { CONFIG_SERVICE } from '@zipbul/common';

import type { HttpServerOptions } from './interfaces';

import { HttpAdapter } from './http-adapter';

interface HttpAdapterBootstrapConfig extends HttpServerOptions {
  readonly name?: string;
}

function isConfigService(value: ZipbulValue): value is ConfigService {
  if (typeof value !== 'object' && typeof value !== 'function') {
    return false;
  }

  if (value === null) {
    return false;
  }

  if (!('get' in value)) {
    return false;
  }

  return typeof value.get === 'function';
}

export function httpAdapter(resolve: (configService: ConfigService) => HttpAdapterBootstrapConfig): BootstrapAdapter {
  return {
    install(app) {
      const container = app.getContainer();
      const tokenName =
        typeof CONFIG_SERVICE === 'symbol' ? (CONFIG_SERVICE.description ?? String(CONFIG_SERVICE)) : String(CONFIG_SERVICE);
      let configService: ConfigService | undefined;

      if (container.has(CONFIG_SERVICE)) {
        const candidate = container.get(CONFIG_SERVICE);

        if (isConfigService(candidate)) {
          configService = candidate;
        }
      }

      if (container.has(tokenName)) {
        const candidate = container.get(tokenName);

        if (isConfigService(candidate)) {
          configService = candidate;
        }
      }

      if (!configService) {
        for (const key of container.keys()) {
          if (typeof key === 'string' && key.endsWith(`::${tokenName}`)) {
            const candidate = container.get(key);

            if (isConfigService(candidate)) {
              configService = candidate;
            }

            break;
          }
        }
      }

      if (!configService) {
        throw new Error(
          `ConfigService is not available. Provide ${tokenName} via bootstrapApplication({ config: { loaders } }) or custom providers.`,
        );
      }

      const config = resolve(configService);
      const { name, ...serverOptions } = config;
      const adapter = new HttpAdapter(serverOptions);

      app.addAdapter(adapter, name !== undefined ? { name } : undefined);
    },
  };
}

export type { HttpAdapterBootstrapConfig };
