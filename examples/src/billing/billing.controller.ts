import { UseMiddlewares, UseExceptionFilters } from '@zipbul/common';
import { inject } from '@zipbul/core';
import { err } from '@zipbul/result';
import { RestController, Post, Get, type HttpContext } from '@zipbul/http-adapter';
import { Logger } from '@zipbul/logger';

import { AuditService } from './audit.service';
import { auditMiddleware } from './audit.middleware';
import { ChargeDto } from './charge.dto';
import { paymentExceptionFilter } from './payment-error.filter';
import { PaymentFailedError } from './payment-failed.error';

@RestController('billing')
@UseMiddlewares(auditMiddleware)
export class BillingController {
  private readonly logger = new Logger('BillingController');
  private readonly auditService = inject(AuditService);

  @Post('charge')
  @UseExceptionFilters(paymentExceptionFilter)
  charge(ctx: HttpContext) {
    const body = ctx.request.getBody(ChargeDto);
    const amount = body.amount || 0;

    this.auditService.logAction('charge', `amount=${amount}`);

    if (amount <= 0) {
      return err({ status: 400, message: 'Invalid amount' });
    }

    if (amount > 1000) {
      throw new PaymentFailedError(amount, 'Insufficient funds for checking account');
    }

    return {
      success: true,
      transactionId: `txn_${Math.random().toString(36).slice(2, 11)}`,
      amount,
      status: 'COMPLETED',
    };
  }

  @Get('history')
  getHistory() {
    return [
      { date: '2025-12-01', amount: 50, status: 'COMPLETED' },
      { date: '2025-12-15', amount: 120, status: 'COMPLETED' },
    ];
  }
}
