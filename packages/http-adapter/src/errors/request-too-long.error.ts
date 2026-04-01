import { StatusCodes } from 'http-status-codes';

import { HttpError } from './http-error';

export class RequestTooLongError extends HttpError {
  constructor(message = 'Content Too Large') {
    super(StatusCodes.REQUEST_TOO_LONG, message);
  }
}
