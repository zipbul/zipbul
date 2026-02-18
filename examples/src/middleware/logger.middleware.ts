import { Middleware, ZipbulMiddleware, type Context } from '@zipbul/common';
import { ZipbulHttpContext } from '@zipbul/http-adapter';
import { Logger } from '@zipbul/logger';

@Middleware()
export class LoggerMiddleware extends ZipbulMiddleware {
  private logger = new Logger('LoggerMiddleware');

  handle(ctx: Context) {
    const http = ctx.to(ZipbulHttpContext);

    this.logger.info(`[${http.request.method}] ${http.request.url}`);
  }
}
