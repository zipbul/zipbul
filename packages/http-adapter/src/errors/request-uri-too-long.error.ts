import { StatusCodes } from 'http-status-codes';

import { HttpError } from './http-error';

export class RequestUriTooLongError extends HttpError {
  constructor(message = 'URI Too Long') {
    super(StatusCodes.REQUEST_URI_TOO_LONG, message);
  }
}
