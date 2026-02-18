import { Inject, Injectable } from '@zipbul/common';
import { Logger, type LogMetadataValue } from '@zipbul/logger';

import type { User } from './interfaces';


@Injectable({
  scope: 'singleton',
  visibleTo: 'all',
})
export class UsersService {
  private readonly userRepository = Inject;
  private readonly logger = new Logger('UsersService');

  findAll(): ReadonlyArray<User> {
    return this.userRepository.findAll();
  }

  findOneById(id: number): User | undefined {
    return this.userRepository.findOneById(id);
  }

  create(body: User): void {
    const metadata: Record<string, LogMetadataValue> = {
      id: body.id,
      name: body.name,
    };

    this.logger.info('Creating user', metadata);

    this.userRepository.create(body);
  }

  update(id: number, data: User): void {
    this.userRepository.updateById(id, data);
  }

  delete(id: number): void {
    this.userRepository.deleteById(id);
  }
}
