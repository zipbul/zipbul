import { Injectable } from '@zipbul/common';

import type { User } from './interfaces';

@Injectable()
export class UserRepository {
  private users: User[] = [
    { id: 1, name: 'John Doe' },
    { id: 2, name: 'Jane Doe' },
    { id: 3, name: 'John Smith' },
    { id: 4, name: 'Jane Smith' },
    { id: 5, name: 'John Doe' },
    { id: 6, name: 'Jane Doe' },
    { id: 7, name: 'John Smith' },
    { id: 8, name: 'Jane Smith' },
    { id: 9, name: 'John Doe' },
    { id: 10, name: 'Jane Doe' },
    { id: 11, name: 'John Smith' },
    { id: 12, name: 'Jane Smith' },
    { id: 13, name: 'John Doe' },
    { id: 14, name: 'Jane Doe' },
    { id: 15, name: 'John Smith' },
    { id: 16, name: 'Jane Smith' },
  ];

  findAll(): ReadonlyArray<User> {
    return this.users;
  }

  findOneById(id: number): User | undefined {
    return this.users.find(user => user.id === id);
  }

  create(data: User): void {
    this.users.push(data);
  }

  updateById(id: number, data: User): void {
    this.users[this.users.findIndex(user => user.id === id)] = data;
  }

  deleteById(id: number): void {
    this.users.splice(
      this.users.findIndex(user => user.id === id),
      1,
    );
  }
}
