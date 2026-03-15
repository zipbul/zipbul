import type { Adapter } from '@zipbul/common';

export interface InternalRouteRequest {
  path?: string;
}

export type InternalRouteHandler = (req?: InternalRouteRequest) => Response;

export interface InternalRouteCall {
  method: string;
  path: string;
  handler: InternalRouteHandler;
}

export interface HttpAdapter extends Adapter {
  registerInternalRoute(method: string, path: string, handler: InternalRouteHandler): void;
}

export interface HttpAdapterSpy {
  adapter: HttpAdapter;
  calls: InternalRouteCall[];
}

export interface InternalRouteHandlerParams {
  calls: InternalRouteCall[];
  path: string;
}
