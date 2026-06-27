export type TrustProxyConfig =
  | boolean
  | number
  | string
  | readonly string[]
  | ((ip: string, hopIndex: number) => boolean);

export type HttpTlsOptions =
  | import('bun').TLSOptions
  | readonly import('bun').TLSOptions[];
