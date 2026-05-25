import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/es';
@Entity()
export class DbUser {
  @PrimaryKey({ type: 'number', autoincrement: true }) id!: number;
  @Property({ type: 'string' }) name!: string;
  @Property({ type: 'string', unique: true }) email!: string;
}
