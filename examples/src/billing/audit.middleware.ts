import { Middleware, ZipbulMiddleware, type Context } from '@zipbul/common';
import { ZipbulHttpContext } from '@zipbul/http-adapter';
import { Logger } from '@zipbul/logger';

@Middleware()
export class AuditMiddleware extends ZipbulMiddleware {
  private logger = new Logger('AuditMiddleware');

  handle(ctx: Context) {
    const http = ctx.to(ZipbulHttpContext);

    this.logger.info(`[AUDIT] Billing Action Attempted: ${http.request.method} ${http.request.url}`);

    // Simulate auditing check
    const headers = http.request.headers;
    const transactionId = headers.get('x-transaction-id');

    if (transactionId === null || transactionId.trim().length === 0) {
      this.logger.warn('[AUDIT] Missing Transaction ID');
    }
  }
}
