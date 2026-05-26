import { Injectable } from '@zipbul/common';
import { MikroOrm, BunPostgreSqlDriver } from '@zipbul/mikro-orm';
import { SqlSchemaGenerator } from '@mikro-orm/sql';
import { User } from '../entities/user.entity';
@Injectable({ scope:'singleton', visibleTo:'all' })
export class Database extends MikroOrm({
  driver: BunPostgreSqlDriver as any,
  clientUrl: 'postgres://poc:poc@127.0.0.1:55477/pocdb',
  entities: [User], extensions: [SqlSchemaGenerator] as any,
}) {}
