export interface InternalRouteRequest {
  path?: string;
}

export type InternalRouteHandler = (req?: InternalRouteRequest) => Response;

export interface InternalRouteCall {
  method: string;
  path: string;
  handler: InternalRouteHandler;
}

export interface HttpAdapter {
  registerInternalRoute?(method: string, path: string, handler: InternalRouteHandler): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface HttpAdapterSpy {
  adapter: HttpAdapter;
  calls: InternalRouteCall[];
}

export interface InternalRouteHandlerParams {
  calls: InternalRouteCall[];
  path: string;
}
