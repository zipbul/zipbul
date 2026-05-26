import { Injectable } from '@zipbul/common';
import { inject } from '@zipbul/core';
import { UserRepository } from './user.repository';
@Injectable({ visibleTo:'all' })
export class UsersService {
  private readonly users = inject(UserRepository);   // <-- inject(UserRepository), exactly the ask
  list() { return this.users.findAll(); }
  emId() { return (this.users.getEntityManager() as any).id; }
}
