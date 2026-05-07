import { defineMiddleware } from '@zipbul/common';
import { Logger } from '@zipbul/logger';

import { TickAdapter, TickContext } from './tick';

const logger = new Logger('TickMiddleware');

export const tickAuditMiddleware = defineMiddleware([TickAdapter], () => {
  return (ctx) => {
    const tick = ctx.to(TickContext);
    logger.info(`audit fired for tick=${String(tick.tickedAt)}`);
  };
});
