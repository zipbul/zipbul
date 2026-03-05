import type { Context } from '@zipbul/common';

import type { HttpRequest } from '../http-request';
import type { HttpResponse } from '../http-response';

export interface HttpContextContract extends Context {
  readonly request: HttpRequest;
  readonly response: HttpResponse;
}
