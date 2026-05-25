import { defineMiddleware } from '@zipbul/common';
import { inject } from '@zipbul/core';
import { HttpAdapter } from '@zipbul/http-adapter';
import { RequestContext } from '@mikro-orm/core';
import { OrmService } from './orm.service';
import { RequestEm } from './request-em.context';
export const requestEmMiddleware = defineMiddleware([HttpAdapter], () => {
  const orm = inject(OrmService);
  return (ctx) => {
    RequestContext.enter(orm.orm.em);
    ctx.set(RequestEm, RequestContext.getEntityManager()!);
  };
});
