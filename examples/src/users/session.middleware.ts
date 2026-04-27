import { defineMiddleware } from '@zipbul/common';
import { HttpContext } from '@zipbul/http-adapter';

import { SessionContext } from './session-context';

/**
 * BeforeHandle 단계에서 Authorization 헤더를 파싱해 세션을 설정한다.
 *
 * `ctx.set(SessionContext, ...)` 호출이 producer 로 분류되어,
 * AOT 검증기가 동일 키를 `ctx.use()` 하는 핸들러의 의존성을 만족시킨다.
 */
export const sessionMiddleware = defineMiddleware(() => (ctx) => {
  const http = ctx.to(HttpContext);
  const auth = http.request.headers.get('authorization');

  if (auth === null || !auth.startsWith('Bearer ')) {
    return;
  }

  const token = auth.slice(7);
  ctx.set(SessionContext, { userId: 1, token });
});
