import { UseMiddlewares, UseExceptionFilters } from '@zipbul/common';
import { inject } from '@zipbul/core';
import { RestController, Post, Get, httpError, type HttpContext } from '@zipbul/http-adapter';

import { AuditService } from './audit.service';
import { auditMiddleware } from './audit.middleware';
import { ChargeDto } from './charge.dto';
import { PaymentGateway } from './payment-gateway';
import { gatewayExceptionFilter } from './gateway-error.filter';

@RestController('billing')
@UseMiddlewares('BeforeHandle', [auditMiddleware])
export class BillingController {
  private readonly auditService = inject(AuditService);
  private readonly gateway = inject(PaymentGateway);

  @Post('charge')
  charge(ctx: HttpContext) {
    const body = ctx.request.getBody(ChargeDto);
    const amount = body.amount;

    this.auditService.logAction('charge', `amount=${amount}`);

    // 비즈니스 실패는 Result 패턴으로 반환 (throw 금지)
    if (amount > 1000) {
      return httpError(402, 'Insufficient funds', [
        { amount, reason: 'checking-account-limit' },
      ]);
    }

    return {
      success: true,
      transactionId: `txn_${Math.random().toString(36).slice(2, 11)}`,
      amount,
      status: 'COMPLETED',
    };
  }

  /**
   * 외부 결제 게이트웨이 호출.
   * 게이트웨이 SDK가 `GatewayTimeoutError`를 throw하면 ExceptionFilter가
   * 504 응답으로 번역한다. 시스템 장애(네트워크·외부 서비스)는 비즈니스
   * 로직이 아니므로 Result가 아닌 throw가 자연스럽다.
   */
  @Post('verify')
  @UseExceptionFilters(gatewayExceptionFilter)
  async verify(ctx: HttpContext) {
    const body = ctx.request.getBody(ChargeDto);
    const reference = await this.gateway.verify(body.amount);
    return { verified: true, reference };
  }

  @Get('history')
  getHistory() {
    return [
      { date: '2025-12-01', amount: 50, status: 'COMPLETED' },
      { date: '2025-12-15', amount: 120, status: 'COMPLETED' },
    ];
  }
}
