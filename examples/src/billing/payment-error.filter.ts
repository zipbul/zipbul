import { ExceptionFilter, type Context, Catch } from '@zipbul/common';
import { ZipbulHttpContext } from '@zipbul/http-adapter';
import { Logger } from '@zipbul/logger';

import { PaymentFailedError } from './payment-failed.error';

@Catch(PaymentFailedError)
export class PaymentErrorFilter extends ExceptionFilter<PaymentFailedError> {
  private logger = new Logger('PaymentErrorFilter');

  public catch(error: PaymentFailedError, ctx: Context): void {
    this.logger.error(`[BILLING ERROR] ${error.message}`);

    const http = ctx.to(ZipbulHttpContext);
    const res = http.response;

    res.setStatus(402);
    res.setBody({
      success: false,
      error: 'PAYMENT_REQUIRED',
      details: error.reason,
      amount: error.amount,
    });
  }
}
