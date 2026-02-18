import { ZipbulContextError, type ZipbulValue, type ClassToken } from '@zipbul/common';

import type { ZipbulRequest } from '../zipbul-request';
import type { ZipbulResponse } from '../zipbul-response';
import type { HttpAdapter } from './http-adapter';
import type { HttpContext } from './interfaces';

import { HTTP_CONTEXT_TYPE } from '../constants';

export class ZipbulHttpContext implements HttpContext {
  private adapter: HttpAdapter;

  constructor(adapter: ZipbulValue) {
    this.adapter = this.assertHttpAdapter(adapter);
  }

  getType(): string {
    return HTTP_CONTEXT_TYPE;
  }

  get(_key: string): ZipbulValue | undefined {
    // Basic implementation for now, can be expanded later
    return undefined;
  }

  to(ctor: typeof ZipbulHttpContext): ZipbulHttpContext;
  to<TContext>(ctor: ClassToken<TContext>): TContext;
  to<TContext>(ctor: ClassToken<TContext> | typeof ZipbulHttpContext): TContext | this {
    if (ctor === ZipbulHttpContext || ctor?.name === ZipbulHttpContext.name) {
      return this;
    }

    throw new ZipbulContextError(`Context cast failed: ${ctor.name || 'UnknownContext'}`);
  }

  get request(): ZipbulRequest {
    return this.adapter.getRequest();
  }

  get response(): ZipbulResponse {
    return this.adapter.getResponse();
  }

  private assertHttpAdapter(value: ZipbulValue): HttpAdapter {
    if (this.isHttpAdapter(value)) {
      return value;
    }

    throw new ZipbulContextError('Invalid HTTP adapter provided to ZipbulHttpContext');
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
