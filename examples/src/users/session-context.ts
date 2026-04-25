import { contextKey, type ContextKey } from '@zipbul/common';

/**
 * 요청 단위 인증 세션 데이터.
 *
 * `sessionMiddleware` 가 `BeforeHandle` phase 에서 `ctx.set(SessionContext, ...)`
 * 으로 채우고, 핸들러는 `ctx.use(SessionContext)` 로 꺼내 쓴다.
 *
 * AOT producer-consumer 검증의 정상 시나리오 — 미들웨어 등록을 누락하면
 * `[Zipbul AOT] Handler '...' calls ctx.use(SessionContext) but no registered
 * middleware produces this key.` 경고가 빌드 단계에서 발화한다.
 */
export interface UserSession {
  readonly userId: number;
  readonly token: string;
}

export const SessionContext: ContextKey<UserSession> = contextKey<UserSession>('users.session');
