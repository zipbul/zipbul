import type { Context, ZipbulValue } from '@zipbul/common';

import { ExceptionFilter, Catch } from '@zipbul/common';
import { BakerValidationError } from '@zipbul/baker';
import { StatusCodes } from 'http-status-codes';

import type { RequestBodyValue } from './types';

import { HttpContext } from './adapter/http-context';

/**
 * Global exception filter that converts `BakerValidationError` into an HTTP 400 response.
 *
 * @public
 */
@Catch()
export class BakerValidationExceptionFilter extends ExceptionFilter {
  public catch(error: ZipbulValue, context: Context): void {
    if (!(error instanceof BakerValidationError)) {
      return;
    }

    const http = context.to(HttpContext);
    const response = http.response;

    const body: RequestBodyValue = {
      message: error.message,
      errors: error.errors.map(fieldError => ({
        path: fieldError.path,
        code: fieldError.code,
        ...(fieldError.message !== undefined ? { message: fieldError.message } : {}),
      })),
    };

    response.setStatus(StatusCodes.BAD_REQUEST);
    response.setBody(body);
  }
}
