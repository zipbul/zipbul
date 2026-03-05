import { defineMiddleware } from '@zipbul/common';
import { HttpContext } from '@zipbul/http-adapter';
import { Logger } from '@zipbul/logger';

const logger = new Logger('LoggerMiddleware');

export const loggerMiddleware = defineMiddleware((ctx) => {
  const http = ctx.to(HttpContext);

  logger.info(`[${http.request.method}] ${http.request.url}`);
});
