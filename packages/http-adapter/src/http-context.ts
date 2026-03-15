import { ContextError, type ZipbulValue, type ClassToken, type ExceptionFilterEntry } from '@zipbul/common';

import type { HttpRequest } from './http-request';
import type { HttpResponse } from './http-response';

import { HTTP_CONTEXT_TYPE } from './constants';

export class HttpContext {
  private _routeErrorFilters: readonly ExceptionFilterEntry[] | undefined;

  constructor(
    private readonly _request: HttpRequest,
    private readonly _response: HttpResponse,
    private readonly _rawRequest?: Request,
  ) {}

  getType(): string {
    return HTTP_CONTEXT_TYPE;
  }

  get(_key: string): ZipbulValue | undefined {
    return undefined;
  }

  to(ctor: typeof HttpContext): HttpContext;
  to<TContext>(ctor: ClassToken<TContext>): TContext;
  to<TContext>(ctor: ClassToken<TContext> | typeof HttpContext): TContext | this {
    if (ctor === HttpContext || ctor?.name === HttpContext.name) {
      return this;
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

  get routeErrorFilters(): readonly ExceptionFilterEntry[] | undefined {
    return this._routeErrorFilters;
  }

  setRouteErrorFilters(filters: readonly ExceptionFilterEntry[]): void {
    this._routeErrorFilters = filters;
  }
}
