import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/es';

@Entity()
export class Event {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string' })
  name!: string;

  @Property({ type: 'Date' })
  occurredAt!: Date;

  @Property({ type: 'json' })
  meta!: { tags: string[]; level: number };

  @Property({ type: 'bigint' })
  counter!: bigint | string;

  @Property({ type: 'boolean' })
  active!: boolean;

  @Property({ type: 'decimal', precision: 10, scale: 2 })
  amount!: string;
}
