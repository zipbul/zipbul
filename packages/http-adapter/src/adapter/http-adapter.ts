import type { HttpRequest } from '../http-request';
import type { HttpResponse } from '../http-response';

export interface HttpAdapter {
  getRequest(): HttpRequest;
  getResponse(): HttpResponse;
  setHeader(name: string, value: string): void;
  setStatus(status: number): void;
}
