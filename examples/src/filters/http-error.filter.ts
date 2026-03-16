import { defineExceptionFilter, type ZipbulValue } from '@zipbul/common';
import { HttpContext } from '@zipbul/http-adapter';
import { Logger, type LogMetadataValue } from '@zipbul/logger';

import type { HttpErrorPayload } from './interfaces';

export const httpExceptionFilter = defineExceptionFilter(
  [],
  () => {
    const logger = new Logger('HttpExceptionFilter');

    return (error: unknown, ctx) => {
      const http = ctx.to(HttpContext);
      const res = http.response;
      const req = http.request;
      const errorPayload = getHttpErrorPayload(error as ZipbulValue);
      const status = resolveStatus(errorPayload?.status);

      logger.error('Caught error:', toLogMetadataValue(error as ZipbulValue));

      res.setStatus(status);
      res.setBody({
        statusCode: status,
        message: errorPayload?.message ?? 'Internal Server Error',
        path: req.url,
      });
    };
  },
);

function getHttpErrorPayload(error: ZipbulValue): HttpErrorPayload | undefined {
  if (error instanceof Error) {
    return { message: error.message };
  }

  if (!isZipbulRecord(error)) {
    return undefined;
  }

  const messageValue = error.message;
  const statusValue = error.status;
  const hasMessage = typeof messageValue === 'string' && messageValue.length > 0;
  const hasStatus = typeof statusValue === 'number';

  if (hasMessage || hasStatus) {
    return {
      ...(hasMessage ? { message: messageValue } : {}),
      ...(hasStatus ? { status: statusValue } : {}),
    };
  }

  return undefined;
}

function resolveStatus(status: HttpErrorPayload['status']): number {
  if (typeof status === 'number' && status !== 101 && status >= 200 && status <= 599) {
    return status;
  }

  return 500;
}

function toLogMetadataValue(value: ZipbulValue): LogMetadataValue {
  if (value instanceof Error) {
    return value;
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'function') {
    return 'function';
  }

  if (typeof value === 'symbol') {
    return 'symbol';
  }

  if (typeof value === 'object') {
    const serialized = JSON.stringify(value);

    return serialized ?? 'Unserializable error';
  }

  return 'Unknown error';
}

function isZipbulRecord(value: ZipbulValue): value is Record<string, ZipbulValue> {
  return typeof value === 'object' && value !== null;
}
