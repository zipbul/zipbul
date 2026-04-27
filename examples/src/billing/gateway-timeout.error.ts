/**
 * 외부 결제 게이트웨이 SDK 타임아웃을 나타내는 시스템 예외.
 *
 * 비즈니스 실패가 아닌 **인프라 장애** (네트워크 타임아웃, 외부 서비스
 * 불능)에 해당하므로 `throw`로 던지고 프레임워크의 ExceptionFilter가
 * 504 응답으로 번역한다.
 */
export class GatewayTimeoutError extends Error {
  public readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`External gateway did not respond within ${timeoutMs}ms`);
    this.name = 'GatewayTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}
