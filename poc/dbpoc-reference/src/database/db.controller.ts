import { UseMiddlewares } from '@zipbul/common';
import { RestController, Get, type HttpContext } from '@zipbul/http-adapter';
import { OrmService } from './orm.service';
import { requestEmMiddleware } from './request-em.middleware';
import { RequestEm } from './request-em.context';
import { DbUser } from './user.entity';
@RestController('db')
@UseMiddlewares('BeforeHandle', [requestEmMiddleware])
export class DbController {
  constructor(private readonly orm: OrmService) {}
  @Get('em-id')
  async emId(ctx: HttpContext): Promise<{ emId: number; viaOrmEm: number; rows: number }> {
    const em = ctx.use(RequestEm);
    const rows = await em.find(DbUser, {});
    return { emId: (em as any).id, viaOrmEm: (this.orm.em as any).id, rows: rows.length };
  }
  @Get('users')
  async list(ctx: HttpContext): Promise<Array<{ id: number; name: string }>> {
    const users = await ctx.use(RequestEm).find(DbUser, {});
    return users.map(u => ({ id: u.id, name: u.name }));
  }
}
