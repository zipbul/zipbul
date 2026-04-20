import { defineExceptionFilter } from '@zipbul/common';
import { err } from '@zipbul/result';
import { Logger } from '@zipbul/logger';

import { GatewayTimeoutError } from './gateway-timeout.error';

/**
 * 외부 결제 게이트웨이 SDK가 `GatewayTimeoutError`를 throw 했을 때
 * 이를 `504 Gateway Timeout` 응답으로 번역한다.
 *
 * ExceptionFilter의 정상 용례: **시스템/인프라 장애 throw → HTTP 번역**.
 * 비즈니스 실패는 Result 패턴 (`httpError`/`err`)으로 처리하며 필터를
 * 통과시키지 않는다.
 */
export const gatewayExceptionFilter = defineExceptionFilter(
  [GatewayTimeoutError],
  () => {
    const logger = new Logger('GatewayExceptionFilter');

    return (exception: GatewayTimeoutError) => {
      logger.error(`[INFRA] ${exception.message}`);

      return err({
        status: 504,
        message: 'Gateway Timeout',
        details: { timeoutMs: exception.timeoutMs },
      });
    };
  },
);
