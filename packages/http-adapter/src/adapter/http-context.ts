import { ContextError, type ZipbulValue, type ClassToken, type ExceptionFilterEntry } from '@zipbul/common';

import type { HttpRequest } from '../http-request';
import type { HttpResponse } from '../http-response';
import type { HttpAdapter } from './http-adapter';
import type { HttpContextContract } from './interfaces';

import { HTTP_CONTEXT_TYPE } from '../constants';

export class HttpContext implements HttpContextContract {
  private adapter: HttpAdapter;
  private _routeErrorFilters: readonly ExceptionFilterEntry[] | undefined;

  constructor(adapter: ZipbulValue) {
    this.adapter = this.assertHttpAdapter(adapter);
  }

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
    return this.adapter.getRequest();
  }

  get response(): HttpResponse {
    return this.adapter.getResponse();
  }

  get rawRequest(): Request | undefined {
    return this.adapter.getRawRequest();
  }

  get routeErrorFilters(): readonly ExceptionFilterEntry[] | undefined {
    return this._routeErrorFilters;
  }

  setRouteErrorFilters(filters: readonly ExceptionFilterEntry[]): void {
    this._routeErrorFilters = filters;
  }

  private assertHttpAdapter(value: ZipbulValue): HttpAdapter {
    if (this.isHttpAdapter(value)) {
      return value;
    }

    throw new ContextError('Invalid HTTP adapter provided to HttpContext');
  }

  private isHttpAdapter(value: ZipbulValue): value is HttpAdapter {
    return (
      typeof value === 'object' &&
      value !== null &&
      'getRequest' in value &&
      'getResponse' in value &&
      'setHeader' in value &&
      'setStatus' in value
    );
  }
}
