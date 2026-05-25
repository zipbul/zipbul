import { RestController, Get, Post } from '@zipbul/http-adapter';
import { OrmService } from './orm.service';
import { DbUser } from './user.entity';
@RestController('db')
export class DbController {
  constructor(private readonly orm: OrmService) {}
  @Get('users')
  async list(): Promise<Array<{ id: number; name: string; email: string }>> {
    const users = await this.orm.repo().findAll();
    return users.map(u => ({ id: u.id, name: u.name, email: u.email }));
  }
  @Post('users')
  async create(): Promise<{ id: number; total: number }> {
    const em = this.orm.em();
    const u = em.create(DbUser, { name: 'Grace Hopper', email: `grace${Date.now()}@db.io` });
    em.persist(u); await em.flush();
    const total = await em.count(DbUser, {});
    return { id: u.id, total };
  }
}
