import { getAdapterContext } from '@zipbul/core';
import { Logger } from '@zipbul/logger';

import { OnTick, TickContext, TickController } from './tick';

@TickController()
export class HeartbeatController {
  private readonly logger = new Logger('Heartbeat');

  @OnTick()
  beat(ctx: TickContext): void {
    // Round-trip via getAdapterContext — proves dispatchRequest's
    // runInAdapterContext wrap is active during handler execution.
    const ambient = getAdapterContext();
    const ambientTick = ambient.to(TickContext);
    this.logger.info(
      `round=${String(ctx.round)} tick=${String(ctx.tickedAt)} ambient.round=${String(ambientTick.round)} same=${String(ambient === ctx)}`,
    );
  }
}
