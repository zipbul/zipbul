import type { ConfigService, ValueLike } from '@zipbul/common';

import type { HttpConfig, HttpDefaultsParams } from './types';

export class ExampleConfigService implements ConfigService {
  private readonly namespaces: Map<string | symbol, ValueLike>;

  constructor(namespaces: ReadonlyMap<string | symbol, ValueLike>) {
    this.namespaces = new Map(namespaces);
  }

  public static withHttpDefaults(params: HttpDefaultsParams): ExampleConfigService {
    const { userHttp, adminHttp } = params;

    return new ExampleConfigService(
      new Map<string, ValueLike>([
        ['user.http', { port: userHttp.port, host: userHttp.host } satisfies HttpConfig],
        ['admin.http', { port: adminHttp.port, host: adminHttp.host } satisfies HttpConfig],
      ]),
    );
  }

  public get(namespace: string | symbol): ValueLike {
    const value = this.namespaces.get(namespace);

    if (value === undefined) {
      throw new Error(`Config namespace not found: ${String(namespace)}`);
    }

    return value;
  }
}
