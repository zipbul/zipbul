import type { PrimitiveRecord } from '@zipbul/common';

export type SomeConfigValue = string | number;

export interface HttpDefaults {
  readonly port: number;
  readonly host: string;
}

export interface HttpDefaultsParams {
  readonly userHttp: HttpDefaults;
  readonly adminHttp: HttpDefaults;
}

export interface HttpConfig extends PrimitiveRecord {
  host: string;
  port: number;
}
