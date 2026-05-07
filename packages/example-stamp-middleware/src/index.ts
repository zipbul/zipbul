import { defineMiddleware } from '@zipbul/common';
import { HttpContext } from '@zipbul/http-adapter';
import { Logger } from '@zipbul/logger';

export const stampMiddleware = defineMiddleware(() => {
  const logger = new Logger('StampMiddleware');
  return (ctx) => {
    const http = ctx.to(HttpContext);
    http.response.setHeader('X-Stamp', 'tested');
    logger.info('stamp set');
  };
});
