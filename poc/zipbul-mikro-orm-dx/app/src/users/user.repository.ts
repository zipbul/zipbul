import { Injectable } from '@zipbul/common';
import { Repository } from '@zipbul/mikro-orm';
import { User } from '../entities/user.entity';
@Injectable({ visibleTo:'all' })
export class UserRepository extends Repository(User) {
  // custom finder demonstrates user methods coexist with delegated repo methods
  byEmail(email: string) { return this.findOne({ email } as any); }
}
