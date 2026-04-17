import { StatusCodes } from 'http-status-codes';

import type { HttpResponse } from '../http-response';
import type { ResponseBodyValue } from '../types';
import { HttpError } from '../errors/http-error';
import { isErrorResponseData } from './type-guards';

export function writeErrorResponse(res: HttpResponse, errorData: unknown): void {
  if (errorData instanceof HttpError) {
    const body: ResponseBodyValue = { statusCode: errorData.statusCode, message: errorData.message };
    res.setStatus(errorData.statusCode);
    res.setBody(body);

    return;
  }

  if (isErrorResponseData(errorData)) {
    const body: ResponseBodyValue = {
      status: errorData.status,
      message: errorData.message,
      ...(errorData.errors !== undefined ? { errors: [...errorData.errors] } : {}),
    };
    res.setStatus(errorData.status);
    res.setBody(body);

    return;
  }

  const body: ResponseBodyValue = { statusCode: StatusCodes.INTERNAL_SERVER_ERROR, message: 'Internal Server Error' };
  res.setStatus(StatusCodes.INTERNAL_SERVER_ERROR);
  res.setBody(body);
}
