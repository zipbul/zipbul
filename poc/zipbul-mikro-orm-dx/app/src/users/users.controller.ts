import { UseMiddlewares } from '@zipbul/common';
import { RestController, Get } from '@zipbul/http-adapter';
import { dbContext } from '../database/db-context.middleware';
import { UsersService } from './users.service';
@RestController('users')
@UseMiddlewares('BeforeHandle', [dbContext])
export class UsersController {
  constructor(private readonly users: UsersService) {}
  @Get()
  async list(): Promise<{ emId:number; rows:Array<{id:number;name:string}> }> {
    return { emId: this.users.emId(), rows: (await this.users.list()).map(u => ({ id:u.id, name:u.name })) };
  }
}
