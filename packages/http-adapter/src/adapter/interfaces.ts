import type { Context } from '@zipbul/common';

import type { ZipbulRequest } from '../zipbul-request';
import type { ZipbulResponse } from '../zipbul-response';

export interface HttpContext extends Context {
  readonly request: ZipbulRequest;
  readonly response: ZipbulResponse;
}
