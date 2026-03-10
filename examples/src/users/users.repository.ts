import { Injectable, type OnInit, type OnDestroy } from '@zipbul/common';
import { Logger } from '@zipbul/logger';

import type { User } from './interfaces';

@Injectable()
export class UserRepository implements OnInit, OnDestroy {
  private readonly logger = new Logger('UserRepository');

  onInit(): void {
    this.logger.info(`Initialized with ${this.users.length} users`);
  }

  onDestroy(): void {
    this.logger.info('Destroyed');
  }

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
