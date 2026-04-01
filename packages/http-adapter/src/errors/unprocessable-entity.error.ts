import { StatusCodes } from 'http-status-codes';

import { HttpError } from './http-error';

export class UnprocessableEntityError extends HttpError {
  constructor(message = 'Unprocessable Content') {
    super(StatusCodes.UNPROCESSABLE_ENTITY, message);
  }
}
