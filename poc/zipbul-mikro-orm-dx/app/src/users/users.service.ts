import { Injectable } from '@zipbul/common';
import { injectRepository, injectEntityManager } from '@zipbul/mikro-orm';
import { User } from '../entities/user.entity';

@Injectable({ visibleTo: 'all' })
export class UsersService {
  private readonly users = injectRepository(User);   // <- request-aware repo, no provider record
  private readonly em = injectEntityManager();

  list() { return this.users.findAll(); }
  emId() { return (this.em as any).id; }              // current (per-request fork) EM id
  async create(name: string, email: string) {
    const u = this.users.create({ name, email });
    await this.em.persistAndFlush(u);
    return u;
  }
}
