import { defineMiddleware } from '@zipbul/common';
import { HttpContext } from '@zipbul/http-adapter';
import { Logger } from '@zipbul/logger';

const logger = new Logger('AuditMiddleware');

export const auditMiddleware = defineMiddleware((ctx) => {
  const http = ctx.to(HttpContext);

  logger.info(`[AUDIT] Billing Action Attempted: ${http.request.method} ${http.request.url}`);

  // Simulate auditing check
  const headers = http.request.headers;
  const transactionId = headers.get('x-transaction-id');

  if (transactionId === null || transactionId.trim().length === 0) {
    logger.warn('[AUDIT] Missing Transaction ID');
  }
});
