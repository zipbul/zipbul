import { Entity, PrimaryKey, Property } from '@zipbul/mikro-orm';
@Entity()
export class User {
  @PrimaryKey({ type:'number', autoincrement:true }) id!: number;
  @Property({ type:'string' }) name!: string;
  @Property({ type:'string', unique:true }) email!: string;
}
