import type { ZipbulAdapter } from '@zipbul/common';

export interface InternalRouteRequest {
  path?: string;
}

export type InternalRouteHandler = (req?: InternalRouteRequest) => Response;

export interface InternalRouteCall {
  path: string;
  handler: InternalRouteHandler;
}

export interface HttpAdapterInternal {
  get(path: string, handler: InternalRouteHandler): void;
}

export interface HttpAdapter extends ZipbulAdapter {
  [key: PropertyKey]: HttpAdapterInternal | ZipbulAdapter['start'] | ZipbulAdapter['stop'] | undefined;
}

export interface HttpAdapterSpy {
  adapter: HttpAdapter;
  calls: InternalRouteCall[];
}

export interface InternalRouteHandlerParams {
  calls: InternalRouteCall[];
  path: string;
}
