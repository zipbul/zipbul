import { ContextError, type ZipbulValue, type ExceptionFilterEntry } from '@zipbul/common';

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

  to<TContext>(ctor: abstract new (...args: never[]) => TContext): TContext {
    if (ctor === (HttpContext as unknown) || ctor?.name === HttpContext.name) {
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

  get routeErrorFilters(): readonly ExceptionFilterEntry[] | undefined {
    return this._routeErrorFilters;
  }

  setRouteErrorFilters(filters: readonly ExceptionFilterEntry[]): void {
    this._routeErrorFilters = filters;
  }
}
