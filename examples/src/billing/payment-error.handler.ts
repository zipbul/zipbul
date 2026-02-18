import { type Context, Catch } from '@zipbul/common';
import { ZipbulHttpContext } from '@zipbul/http-adapter';
import { Logger } from '@zipbul/logger';

import { PaymentFailedError } from './payment-failed.error';

@Catch(PaymentFailedError)
export class PaymentErrorHandler {
  private logger = new Logger('PaymentErrorHandler');

  catch(error: PaymentFailedError, ctx: Context) {
    this.logger.error(`[BILLING ERROR] ${error.message}`);

    const http = ctx.to(ZipbulHttpContext);
    const res = http.response;

    res.setStatus(402); // Payment Required

    return {
      success: false,
      error: 'PAYMENT_REQUIRED',
      details: error.reason,
      amount: error.amount,
    };
  }
}
