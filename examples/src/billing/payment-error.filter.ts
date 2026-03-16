import { ExceptionFilter, Injectable, err, type Err, type Context, Catch } from '@zipbul/common';
import { Logger } from '@zipbul/logger';

import { PaymentFailedError } from './payment-failed.error';

@Injectable()
@Catch(PaymentFailedError)
export class PaymentErrorFilter extends ExceptionFilter<PaymentFailedError> {
  private readonly logger = new Logger('PaymentErrorFilter');

  public catch(error: PaymentFailedError, _ctx: Context): Err<unknown> {
    this.logger.error(`[BILLING ERROR] ${error.message}`);

    return err({
      status: 402,
      message: 'PAYMENT_REQUIRED',
      details: error.reason,
      amount: error.amount,
    });
  }
}
