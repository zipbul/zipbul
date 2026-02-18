import type { ZipbulValue, ConfigService } from '@zipbul/common';
import type { BootstrapAdapter } from '@zipbul/core';

import { CONFIG_SERVICE } from '@zipbul/common';

import type { ZipbulHttpServerOptions } from './interfaces';

import { ZipbulHttpAdapter } from './zipbul-http-adapter';

interface ZipbulHttpAdapterBootstrapConfig extends ZipbulHttpServerOptions {
  readonly name: string;
  readonly protocol?: string;
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

export function zipbulHttpAdapter(resolve: (configService: ConfigService) => ZipbulHttpAdapterBootstrapConfig): BootstrapAdapter {
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
      const { name, protocol, ...serverOptions } = config;
      const adapter = new ZipbulHttpAdapter(serverOptions);

      app.addAdapter(adapter, {
        name,
        protocol: protocol ?? 'http',
      });
    },
  };
}

export type { ZipbulHttpAdapterBootstrapConfig };
