import { defineExceptionFilter, err } from '@zipbul/common';
import { Logger } from '@zipbul/logger';

import { PaymentFailedError } from './payment-failed.error';

export const paymentExceptionFilter = defineExceptionFilter(
  [PaymentFailedError],
  () => {
    const logger = new Logger('PaymentExceptionFilter');

    return (exception: PaymentFailedError) => {
      logger.error(`[BILLING ERROR] ${exception.message}`);

      return err({
        status: 402,
        message: 'PAYMENT_REQUIRED',
        details: exception.reason,
        amount: exception.amount,
      });
    };
  },
);
