import { test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { MikroORM, PrimaryKeyProp, UniqueConstraintViolationException } from '@mikro-orm/core';

import { Entity, PrimaryKey, Property } from '../../src/entity';
import { BunPostgreSqlDriver } from '../../src/driver';
import { PG_URL, describePg, makeOrm, freshSchema } from './helpers';

// Composite primary key (two @PrimaryKey columns + the PrimaryKeyProp marker).
@Entity()
class Enrollment {
  @PrimaryKey({ type: 'number' })
  studentId!: number;

  @PrimaryKey({ type: 'number' })
  courseId!: number;

  @Property({ type: 'string' })
  grade!: string;

  [PrimaryKeyProp]?: ['studentId', 'courseId'];
}

describePg('composite primary key (postgres)', () => {
  let orm: MikroORM;
  beforeAll(async () => {
    orm = await makeOrm(BunPostgreSqlDriver, PG_URL!, [Enrollment]);
  });
  afterAll(async () => {
    await orm.close(true);
  });
  beforeEach(async () => {
    await freshSchema(orm);
  });

  test('an entity with a two-column primary key round-trips and is fetchable by composite key', async () => {
    const em = orm.em.fork();
    em.persist(em.create(Enrollment, { studentId: 1, courseId: 10, grade: 'A' }));
    em.persist(em.create(Enrollment, { studentId: 1, courseId: 20, grade: 'B' }));
    await em.flush();

    const found = await orm.em.fork().findOneOrFail(Enrollment, { studentId: 1, courseId: 20 });
    expect(found.grade).toBe('B');

    expect(await orm.em.fork().count(Enrollment, { studentId: 1 })).toBe(2);
  });

  test('the composite key enforces uniqueness of the pair', async () => {
    const em = orm.em.fork();
    em.persist(em.create(Enrollment, { studentId: 2, courseId: 30, grade: 'C' }));
    await em.flush();

    const em2 = orm.em.fork();
    em2.persist(em2.create(Enrollment, { studentId: 2, courseId: 30, grade: 'D' }));
    await expect(em2.flush()).rejects.toBeInstanceOf(UniqueConstraintViolationException);
  });
});
