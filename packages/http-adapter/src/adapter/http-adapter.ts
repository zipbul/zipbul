import type { ZipbulRequest } from '../zipbul-request';
import type { ZipbulResponse } from '../zipbul-response';

export interface HttpAdapter {
  getRequest(): ZipbulRequest;
  getResponse(): ZipbulResponse;
  setHeader(name: string, value: string): void;
  setStatus(status: number): void;
}
