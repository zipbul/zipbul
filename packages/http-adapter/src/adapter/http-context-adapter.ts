import type { HttpRequest } from '../http-request';
import type { HttpResponse } from '../http-response';
import type { HttpAdapter } from './http-adapter';

export class HttpContextAdapter implements HttpAdapter {
  constructor(
    private req: HttpRequest,
    private res: HttpResponse,
    private rawReq?: Request,
  ) {}

  getRequest(): HttpRequest {
    return this.req;
  }

  getResponse(): HttpResponse {
    return this.res;
  }

  setHeader(name: string, value: string): void {
    this.res.setHeader(name, value);
  }

  setStatus(status: number): void {
    this.res.setStatus(status);
  }

  getRawRequest(): Request | undefined {
    return this.rawReq;
  }
}
