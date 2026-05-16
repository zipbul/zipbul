import type { HttpMethod } from '../enums';

export type TrustProxyConfig =
  | boolean
  | number
  | string
  | readonly string[]
  | ((ip: string, hopIndex: number) => boolean);

export type HttpTlsOptions =
  | import('bun').TLSOptions
  | readonly import('bun').TLSOptions[];

export type HttpMethodToken = HttpMethod | (string & {});
