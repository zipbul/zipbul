import { Injectable } from '@zipbul/common';
import { inject } from '@zipbul/core';
import { Database } from '../database/orm.service';
import { User } from '../entities/user.entity';
@Injectable({ visibleTo:'all' })
export class UsersService {
  private readonly db = inject(Database);
  list() { return this.db.repo(User).findAll(); }
  emId() { return (this.db.em as any).id; }
  async create(name:string, email:string) {
    const u = this.db.repo(User).create({ name, email });
    await this.db.em.persistAndFlush(u);
    return u;
  }
}
