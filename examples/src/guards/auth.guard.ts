import { defineGuard, err } from '@zipbul/common';
import { HttpContext } from '@zipbul/http-adapter';

export const authGuard = defineGuard((ctx) => {
  const http = ctx.to(HttpContext);
  const token = http.request.headers.get('authorization') ?? '';

  if (token.length === 0) {
    return err({ status: 403, message: 'Forbidden: missing authorization header' });
  }
});
