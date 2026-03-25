import { ContextError, type ClassToken, type ResolvedExceptionFilter, type ZipbulContainer } from '@zipbul/common';

import type { HttpRequest } from './http-request';
import type { HttpResponse } from './http-response';
import type { RouteHandlerEntry } from './interfaces';

import { HTTP_CONTEXT_TYPE } from './constants';

export class HttpContext {
  private _routeExceptionFilters: readonly ResolvedExceptionFilter[] | undefined;
  private _matchedRoute: RouteHandlerEntry | undefined;

  constructor(
    private readonly _request: HttpRequest,
    private readonly _response: HttpResponse,
    private readonly _rawRequest?: Request,
    private readonly _container?: ZipbulContainer,
  ) {}

  getType(): string {
    return HTTP_CONTEXT_TYPE;
  }

  get(_key: string): undefined {
    return undefined;
  }

  to<TContext>(ctor: ClassToken<TContext>): TContext {
    if (ctor === HttpContext) {
      return this as unknown as TContext;
    }

    throw new ContextError(`Context cast failed: ${ctor.name || 'UnknownContext'}`);
  }

  get request(): HttpRequest {
    return this._request;
  }

  get response(): HttpResponse {
    return this._response;
  }

  get rawRequest(): Request | undefined {
    return this._rawRequest;
  }

  get container(): ZipbulContainer | undefined {
    return this._container;
  }

  get routeExceptionFilters(): readonly ResolvedExceptionFilter[] | undefined {
    return this._routeExceptionFilters;
  }

  setRouteExceptionFilters(filters: readonly ResolvedExceptionFilter[]): void {
    this._routeExceptionFilters = filters;
  }

  get matchedRoute(): RouteHandlerEntry | undefined {
    return this._matchedRoute;
  }

  set matchedRoute(route: RouteHandlerEntry | undefined) {
    this._matchedRoute = route;
  }
}
