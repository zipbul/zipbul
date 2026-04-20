import { Injectable } from '@zipbul/common';

import { GatewayTimeoutError } from './gateway-timeout.error';

/**
 * 외부 결제 게이트웨이 SDK 시뮬레이터.
 *
 * 실제 배포에서는 `stripe`, `toss-payments` 같은 3rd-party 패키지가 이
 * 자리를 차지한다. 외부 SDK는 네트워크 장애 시 `throw`로 예외를 전파
 * 하며, 애플리케이션이 이를 HTTP 응답으로 번역해야 한다.
 */
@Injectable()
export class PaymentGateway {
  private readonly timeoutMs = 50;

  public async verify(amount: number): Promise<string> {
    // amount % 7 === 0 인 경우 타임아웃을 시뮬레이션 (demo 용)
    if (amount % 7 === 0) {
      await new Promise((resolve) => setTimeout(resolve, this.timeoutMs));
      throw new GatewayTimeoutError(this.timeoutMs);
    }

    return `gw_ref_${amount}_${Date.now()}`;
  }
}
