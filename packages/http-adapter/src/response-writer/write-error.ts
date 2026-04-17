import { StatusCodes } from 'http-status-codes';

import type { HttpResponse } from '../http-response';
import { HttpError } from '../errors/http-error';
import { isErrorResponseData } from './type-guards';

export function writeErrorResponse(res: HttpResponse, errorData: unknown): void {
  if (errorData instanceof HttpError) {
    res.setStatus(errorData.statusCode);
    res.setBody({ status: errorData.statusCode, message: errorData.message });
    return;
  }

  if (isErrorResponseData(errorData)) {
    res.setStatus(errorData.status);
    res.setBody({
      status: errorData.status,
      message: errorData.message,
      ...(errorData.errors !== undefined ? { errors: [...errorData.errors] } : {}),
    });
    return;
  }

  res.setStatus(StatusCodes.INTERNAL_SERVER_ERROR);
  res.setBody({ status: StatusCodes.INTERNAL_SERVER_ERROR, message: 'Internal Server Error' });
}
