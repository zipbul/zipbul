import { defineMiddleware } from '@zipbul/common';
import { HttpContext } from '@zipbul/http-adapter';
import { Logger } from '@zipbul/logger';

export const loggerMiddleware = defineMiddleware(() => {
  const logger = new Logger('LoggerMiddleware');

  return (ctx) => {
    const http = ctx.to(HttpContext);

    logger.info(`[${http.request.method}] ${http.request.url}`);
  };
});
