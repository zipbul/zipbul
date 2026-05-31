import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MikroORM, type EventArgs, type EventSubscriber, type Options } from '@mikro-orm/core';
import { SqlSchemaGenerator } from '@mikro-orm/sql';

import { Entity, PrimaryKey, Property } from '../../src/entity';
import { BunPostgreSqlDriver } from '../../src/driver';
import { PG_URL, describePg } from './helpers';

@Entity()
class SubRow {
  @PrimaryKey({ type: 'number', autoincrement: true })
  id!: number;

  @Property({ type: 'string' })
  name!: string;
}

const events: string[] = [];

class SubRowSubscriber implements EventSubscriber<SubRow> {
  getSubscribedEntities(): [typeof SubRow] {
    return [SubRow];
  }
  afterCreate(args: EventArgs<SubRow>): void {
    events.push(`afterCreate:${args.entity.name}`);
  }
  afterUpdate(args: EventArgs<SubRow>): void {
    events.push(`afterUpdate:${args.entity.name}`);
  }
  afterDelete(): void {
    events.push('afterDelete');
  }
}

describePg('event subscribers (postgres)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await MikroORM.init({
      driver: BunPostgreSqlDriver,
      clientUrl: PG_URL,
      entities: [SubRow],
      extensions: [SqlSchemaGenerator],
      subscribers: [new SubRowSubscriber()],
    } as unknown as Options);
  });
  afterAll(async () => {
    await orm.close(true);
  });
  beforeEach(async () => {
    const s = orm as unknown as { schema: { drop(o?: { dropForeignKeys?: boolean }): Promise<void>; create(): Promise<void> } };
    await s.schema.drop({ dropForeignKeys: true });
    await s.schema.create();
    events.length = 0;
  });

  test('a registered subscriber receives create / update / delete events', async () => {
    const em = orm.em.fork();
    const r = em.create(SubRow, { name: 'sub' });
    em.persist(r);
    await em.flush();

    const em2 = orm.em.fork();
    const loaded = await em2.findOneOrFail(SubRow, { name: 'sub' });
    loaded.name = 'sub2';
    await em2.flush();

    const em3 = orm.em.fork();
    em3.remove(await em3.findOneOrFail(SubRow, { name: 'sub2' }));
    await em3.flush();

    expect(events).toEqual(['afterCreate:sub', 'afterUpdate:sub2', 'afterDelete']);
  });
});
