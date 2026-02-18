import type { ZipbulRequest } from '../zipbul-request';
import type { ZipbulResponse } from '../zipbul-response';
import type { HttpAdapter } from './http-adapter';

export class ZipbulHttpContextAdapter implements HttpAdapter {
  constructor(
    private req: ZipbulRequest,
    private res: ZipbulResponse,
  ) {}

  getRequest(): ZipbulRequest {
    return this.req;
  }

  getResponse(): ZipbulResponse {
    return this.res;
  }

  setHeader(name: string, value: string): void {
    this.res.setHeader(name, value);
  }

  setStatus(status: number): void {
    this.res.setStatus(status);
  }
}
