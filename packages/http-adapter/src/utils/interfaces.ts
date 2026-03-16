import type { Server } from 'bun';

export interface ClientIpOptions {
  trustProxy?: boolean;
}

export interface ClientIpsResult {
  ip: string | undefined;
  ips: string[] | undefined;
}

export interface MockServerCalls {
  request: number;
}

export interface MockServerResult {
  server: Pick<Server<unknown>, 'requestIP'>;
  calls: MockServerCalls;
}
